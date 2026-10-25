terraform {
  required_version = ">= 1.5"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

# ---------------------------------------------------------------------------
# AMI: última Ubuntu 22.04 LTS oficial de Canonical
# ---------------------------------------------------------------------------
data "aws_ami" "ubuntu" {
  most_recent = true
  owners      = ["099720109477"] # Canonical

  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-amd64-server-*"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

# ---------------------------------------------------------------------------
# Red: solo 80/443 de entrada. Sin puerto 22 — el acceso administrativo es
# por AWS Systems Manager (SSM Session Manager), no por SSH.
# ---------------------------------------------------------------------------
resource "aws_security_group" "eventstock" {
  name        = "eventstock-sg"
  description = "EventStock - solo HTTP/HTTPS de entrada; sin SSH (acceso por SSM)"

  ingress {
    description = "HTTP"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "HTTPS (reservado para cuando haya dominio + Certbot)"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name    = "eventstock-sg"
    Project = "EventStock"
  }
}

# ---------------------------------------------------------------------------
# IAM: rol para que la instancia pueda ser administrada por SSM
# ---------------------------------------------------------------------------
resource "aws_iam_role" "ssm_role" {
  name = "eventstock-ssm-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
    }]
  })

  tags = { Project = "EventStock" }
}

resource "aws_iam_role_policy_attachment" "ssm_core" {
  role       = aws_iam_role.ssm_role.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_instance_profile" "ssm_profile" {
  name = "eventstock-ssm-profile"
  role = aws_iam_role.ssm_role.name
}

# ---------------------------------------------------------------------------
# Instancia EC2
# ---------------------------------------------------------------------------
resource "aws_instance" "eventstock" {
  ami                    = data.aws_ami.ubuntu.id
  instance_type          = var.instance_type
  iam_instance_profile   = aws_iam_instance_profile.ssm_profile.name
  vpc_security_group_ids = [aws_security_group.eventstock.id]

  user_data = templatefile("${path.module}/templates/user_data.sh.tpl", {
    repo_url_https_no_scheme          = var.repo_url_https_no_scheme
    repo_branch                       = var.repo_branch
    github_token                      = var.github_token
    firebase_service_account_json_b64 = base64encode(var.firebase_service_account_json)
    session_secret_key                = var.session_secret_key
    app_environment                   = var.app_environment
  })

  tags = {
    Name    = "eventstock-ec2"
    Project = "EventStock"
  }
}

# ---------------------------------------------------------------------------
# IP pública fija (sin esto, la IP cambia cada vez que se reinicia la
# instancia, y un futuro dominio no podría apuntarle de forma estable)
# ---------------------------------------------------------------------------
resource "aws_eip" "eventstock" {
  instance = aws_instance.eventstock.id
  domain   = "vpc"

  tags = { Project = "EventStock" }
}
