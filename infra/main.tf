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

data "aws_caller_identity" "current" {}

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
# S3: bucket privado donde se sube el .zip con el código de la app.
# La instancia lo descarga al arrancar (en vez de clonar desde GitHub).
# ---------------------------------------------------------------------------
resource "aws_s3_bucket" "app_code" {
  bucket = "eventstock-app-code-${data.aws_caller_identity.current.account_id}"
  tags   = { Project = "EventStock" }
}

resource "aws_s3_bucket_public_access_block" "app_code" {
  bucket = aws_s3_bucket.app_code.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_object" "app_code" {
  bucket = aws_s3_bucket.app_code.id
  key    = "app.zip"
  source = var.app_zip_path
  etag   = filemd5(var.app_zip_path)
}

# ---------------------------------------------------------------------------
# IAM: rol para que la instancia pueda ser administrada por SSM y pueda
# descargar el .zip del código desde el bucket S3 anterior.
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

resource "aws_iam_role_policy" "s3_read_app_code" {
  name = "eventstock-s3-read-app-code"
  role = aws_iam_role.ssm_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["s3:GetObject"]
      Resource = "${aws_s3_bucket.app_code.arn}/${aws_s3_object.app_code.key}"
    }]
  })
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
    aws_region                        = var.aws_region
    s3_bucket                         = aws_s3_bucket.app_code.id
    s3_key                            = aws_s3_object.app_code.key
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
