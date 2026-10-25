output "instance_id" {
  description = "ID de la instancia EC2 (úsalo para conectarte por SSM)."
  value       = aws_instance.eventstock.id
}

output "public_ip" {
  description = "IP pública fija de la aplicación (http://<esta-ip>/)."
  value       = aws_eip.eventstock.public_ip
}

output "ssm_connect_command" {
  description = "Comando para abrir una sesión administrativa (sin SSH)."
  value       = "aws ssm start-session --target ${aws_instance.eventstock.id} --region ${var.aws_region}"
}
