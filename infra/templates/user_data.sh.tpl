#!/bin/bash
# Script de aprovisionamiento de EventStock en AWS EC2.
# Generado por Terraform a partir de templates/user_data.sh.tpl — no editar
# a mano en el servidor; cualquier cambio debe hacerse aquí y reaplicarse.
set -euxo pipefail

export DEBIAN_FRONTEND=noninteractive

# ---------------------------------------------------------------------------
# 1. Paquetes del sistema
#    (incluye las librerías nativas que WeasyPrint necesita para generar PDF)
# ---------------------------------------------------------------------------
apt-get update -y
apt-get install -y \
  python3 python3-venv python3-pip awscli unzip nginx \
  libpango-1.0-0 libpangoft2-1.0-0 libharfbuzz0b \
  libgdk-pixbuf2.0-0 libffi-dev shared-mime-info fonts-liberation

# ---------------------------------------------------------------------------
# 2. Código de la aplicación (descargado desde S3, no clonado de GitHub)
# ---------------------------------------------------------------------------
APP_DIR=/opt/eventstock
rm -rf "$APP_DIR" /tmp/app.zip /tmp/app_extracted
mkdir -p "$APP_DIR" /tmp/app_extracted

aws s3 cp "s3://${s3_bucket}/${s3_key}" /tmp/app.zip --region "${aws_region}"
unzip -q /tmp/app.zip -d /tmp/app_extracted

# Si el .zip contiene una sola carpeta raíz (ej. "happy-art-eventos_desarrollo/"),
# usamos su contenido; si no, usamos la raíz extraída directamente.
SRC_DIR=/tmp/app_extracted
ENTRIES=$(find /tmp/app_extracted -mindepth 1 -maxdepth 1)
if [ "$(echo "$ENTRIES" | wc -l)" -eq 1 ] && [ -d "$ENTRIES" ]; then
  SRC_DIR="$ENTRIES"
fi
cp -r "$SRC_DIR"/. "$APP_DIR"/
rm -rf /tmp/app.zip /tmp/app_extracted

cd "$APP_DIR"
python3 -m venv venv
./venv/bin/pip install --upgrade pip
./venv/bin/pip install -r requirements.txt

# ---------------------------------------------------------------------------
# 3. Credenciales de Firebase (decodificadas desde base64 para evitar
#    problemas de escapado del JSON) y variables de entorno de la app
# ---------------------------------------------------------------------------
echo "${firebase_service_account_json_b64}" | base64 -d > "$APP_DIR/firebase-service-account.json"
chmod 600 "$APP_DIR/firebase-service-account.json"

cat > /etc/eventstock.env <<EOF
FIREBASE_SERVICE_ACCOUNT_FILE=$APP_DIR/firebase-service-account.json
SESSION_SECRET_KEY=${session_secret_key}
ENVIRONMENT=${app_environment}
EOF
chmod 600 /etc/eventstock.env

chown -R ubuntu:ubuntu "$APP_DIR"

# ---------------------------------------------------------------------------
# 4. Servicio systemd (Uvicorn, solo en localhost — Nginx es el único que
#    queda expuesto a internet)
# ---------------------------------------------------------------------------
cat > /etc/systemd/system/eventstock.service <<EOF
[Unit]
Description=EventStock - App FastAPI
After=network.target

[Service]
User=ubuntu
Group=ubuntu
WorkingDirectory=$APP_DIR
EnvironmentFile=/etc/eventstock.env
ExecStart=$APP_DIR/venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now eventstock

# ---------------------------------------------------------------------------
# 5. Nginx como reverse proxy (HTTP por ahora; HTTPS/Certbot se añade cuando
#    haya un dominio apuntando a la IP elástica de esta instancia)
# ---------------------------------------------------------------------------
cat > /etc/nginx/sites-available/eventstock <<'EOF'
server {
    listen 80;
    server_name _;

    client_max_body_size 10M;

    location /static/ {
        alias /opt/eventstock/app/static/;
    }

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
EOF

rm -f /etc/nginx/sites-enabled/default
ln -sf /etc/nginx/sites-available/eventstock /etc/nginx/sites-enabled/eventstock
nginx -t
systemctl restart nginx
systemctl enable nginx

echo "Aprovisionamiento de EventStock completado."
