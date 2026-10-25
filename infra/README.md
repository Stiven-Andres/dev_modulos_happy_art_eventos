# Despliegue de EventStock en AWS EC2 (Infraestructura como Código)

Este directorio crea, con Terraform, el servidor donde corre el backend de
EventStock: una instancia EC2 (Ubuntu 22.04) con Nginx como reverse proxy
delante de la app FastAPI (Uvicorn + systemd), siguiendo el mismo diseño que
el diagrama de despliegue `eventstock_despliegue_aws.drawio`.

El código que se despliega es el de un `.zip` local (el mismo que ya tienes
con el proyecto completo) — no se clona desde GitHub ni depende del
repositorio de este repositorio (`dev_modulos_happy_art_eventos`).

## Qué crea este Terraform

- Un bucket S3 privado donde se sube tu `.zip` con el código de la app.
- Una instancia EC2 `t3.micro` (capa gratuita) con Ubuntu 22.04.
- Un Security Group que **solo** abre los puertos 80 y 443 — **no hay SSH
  abierto**. El acceso administrativo es por **AWS Systems Manager (SSM
  Session Manager)**, no por llave SSH.
- Un rol IAM con permiso de SSM y de lectura (`s3:GetObject`) sobre ese
  bucket, adjunto a la instancia.
- Una IP elástica (fija), para que no cambie si la instancia se reinicia.
- Al arrancar, la instancia se aprovisiona sola (`templates/user_data.sh.tpl`):
  descarga el `.zip` desde S3, lo descomprime, instala dependencias,
  configura el servicio `systemd` de la app y el `server block` de Nginx.

## Qué NO hace (todavía)

- **No hay HTTPS.** Mientras no haya un dominio apuntando a la IP elástica,
  Let's Encrypt/Certbot no puede emitir un certificado para una IP sola. La
  app queda accesible por `http://<ip-elástica>/`. Cuando haya dominio, se
  agrega Certbot en un paso aparte.
- No hace redeploy automático cuando cambia el código — hay que volver a
  generar el `.zip` y aplicar de nuevo (ver abajo) o montar un pipeline de
  CI/CD aparte.

## Requisitos antes de aplicar

1. [Terraform](https://developer.hashicorp.com/terraform/install) >= 1.5.
2. [AWS CLI](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html)
   configurado con tus credenciales (`aws configure`), con permisos para
   crear instancias EC2, Security Groups, roles IAM, buckets S3 e IPs
   elásticas.
3. El [plugin de Session Manager](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html)
   para el AWS CLI (para poder conectarte a la instancia sin SSH).
4. El `.zip` con el código completo de la app, en tu máquina (es el mismo
   que ya tienes del proyecto).
5. El contenido del JSON de la cuenta de servicio de Firebase (el mismo que
   ya usas en Render).

## Cómo aplicarlo

```bash
cd infra
cp terraform.tfvars.example terraform.tfvars
# edita terraform.tfvars con tus valores reales (nunca lo subas a git)

terraform init
terraform plan      # revisa qué se va a crear antes de aplicar
terraform apply
```

Al terminar, Terraform imprime la IP pública y el comando para conectarte:

```bash
terraform output public_ip
terraform output ssm_connect_command   # ej: aws ssm start-session --target i-0abc123... --region us-east-1
```

Abre `http://<public_ip>/login` en el navegador para confirmar que la app
responde.

## Para actualizar el código desplegado

Como no hay redeploy automático, cuando cambie el código:

1. Genera de nuevo el `.zip` con la versión actualizada.
2. Si cambiaste la ruta, actualiza `app_zip_path` en `terraform.tfvars`
   (si es la misma ruta, Terraform detecta el cambio de contenido solo).
3. Recrea la instancia para que tome el `.zip` nuevo:

```bash
terraform apply   # sube el .zip nuevo a S3 si cambió
terraform taint aws_instance.eventstock
terraform apply   # recrea la instancia, que descarga el .zip actualizado
```

(Esto recrea la instancia desde cero con el `.zip` más reciente y conserva
la misma IP elástica.)

## ⚠️ Limitación conocida de este enfoque "simple" de secretos

La clave de Firebase y `SESSION_SECRET_KEY` viajan dentro del **user-data**
de la instancia. El user-data no es verdaderamente secreto: cualquiera con
permiso IAM para `ec2:DescribeInstanceAttribute` sobre esta instancia, o con
acceso a la instancia misma (vía `http://169.254.169.254/latest/user-data`),
puede leerlo. Para este alcance (proyecto académico/pequeño) es un costo
aceptable — es la opción que se eligió en vez de AWS Secrets Manager. Si en
algún momento se quiere cerrar esta brecha, la migración natural es mover
estos valores a Secrets Manager y que la instancia los lea en el arranque en
vez de recibirlos por user-data.

## Para destruir todo

```bash
terraform destroy
```
