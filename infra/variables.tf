variable "aws_region" {
  description = "Región de AWS donde se despliega la instancia."
  type        = string
  default     = "us-east-1"
}

variable "instance_type" {
  description = "Tipo de instancia EC2 (t3.micro / t2.micro están en capa gratuita)."
  type        = string
  default     = "t3.micro"
}

variable "repo_url_https_no_scheme" {
  description = "Repositorio de GitHub sin el esquema https://, ej. github.com/usuario/repo.git"
  type        = string
  default     = "github.com/BryanG03036/happy-art-eventos_desarrollo.git"
}

variable "repo_branch" {
  description = "Rama a desplegar."
  type        = string
  default     = "master"
}

variable "github_token" {
  description = "Token de acceso personal de GitHub con permiso de lectura (Contents: Read-only) sobre el repositorio privado. NUNCA lo pongas en este archivo .tf; va en terraform.tfvars (no versionado)."
  type        = string
  sensitive   = true
}

variable "firebase_service_account_json" {
  description = "Contenido completo del JSON de la cuenta de servicio de Firebase. NUNCA lo pongas aquí; va en terraform.tfvars (no versionado)."
  type        = string
  sensitive   = true
}

variable "session_secret_key" {
  description = "Clave aleatoria para firmar la cookie de sesión. Generar con: python3 -c \"import secrets; print(secrets.token_hex(32))\". NUNCA la pongas aquí; va en terraform.tfvars (no versionado)."
  type        = string
  sensitive   = true
}

variable "app_environment" {
  description = "Valor de la variable ENVIRONMENT de la app."
  type        = string
  default     = "production"
}

variable "allowed_ssh_cidr" {
  description = "No se usa: el acceso administrativo es por AWS Systems Manager (SSM), no por SSH. Se deja documentado por si en el futuro se decide habilitar SSH como respaldo."
  type        = string
  default     = "0.0.0.0/32" # efectivamente deshabilitado; no se abre el puerto 22 en el Security Group
}
