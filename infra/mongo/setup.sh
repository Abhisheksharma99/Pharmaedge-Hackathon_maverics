#!/usr/bin/env bash
# Generates the self-hosted MongoDB's secrets and TLS certificates into infra/mongo/secrets/ (git-ignored).
#
#   infra/mongo/setup.sh                            local: certificate for mongo, localhost, 127.0.0.1
#   infra/mongo/setup.sh db.example.com 203.0.113.7 server: also the public name / IP clients connect to
#
# Re-running keeps the passwords, keyfile and CA, and re-issues the server certificate (to add a host, or
# before it expires after 825 days). Then `docker compose up -d mongo` loads it.
set -euo pipefail
cd "$(dirname "$0")"
umask 077
mkdir -p secrets
IMAGE=mongodb/mongodb-community-server:9.0.2-ubi9

# Certificates are made with the image's OpenSSL 3 (macOS ships LibreSSL); files stay owned by you.
ossl() { docker run --rm --user "$(id -u):$(id -g)" -v "$PWD/secrets:/out" -w /out --entrypoint openssl "$IMAGE" "$@"; }

if [ ! -f secrets/mongo.env ]; then
  app=$(openssl rand -hex 24)
  mongot=$(openssl rand -hex 24)
  cat > secrets/mongo.env <<EOF
MONGODB_INITDB_ROOT_USERNAME=root
MONGODB_INITDB_ROOT_PASSWORD=$(openssl rand -hex 24)
MONGO_APP_PASSWORD=$app
MONGO_TEAM_PASSWORD=$(openssl rand -hex 24)
MONGOT_PASSWORD=$mongot
MONGO_KEYFILE=$(openssl rand -base64 756 | tr -d '\n')
EOF
  printf 'MONGOT_PASSWORD=%s\n' "$mongot" > secrets/mongot.env
  # Connection string for the api / crawler containers (docker-compose env_file).
  printf 'MONGODB_URI=mongodb://app:%s@mongo:27017/?replicaSet=rs0&authSource=admin&tls=true&tlsCAFile=/etc/mongo/ca.pem\n' \
    "$app" > secrets/app.env
  echo "Generated passwords and keyfile."
fi

if [ ! -f secrets/ca.key ]; then
  cat > secrets/ca.cnf <<EOF
[req]
distinguished_name = dn
prompt = no
x509_extensions = ca
[dn]
CN = Asset Journey MongoDB CA
[ca]
basicConstraints = critical,CA:TRUE
keyUsage = critical,keyCertSign,cRLSign
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid:always
EOF
  ossl req -x509 -new -newkey ec -pkeyopt ec_paramgen_curve:P-256 -noenc -days 3650 \
    -config ca.cnf -keyout ca.key -out ca.pem
  rm secrets/ca.cnf
  echo "Generated CA (secrets/ca.pem is the file clients need)."
fi

san="DNS:mongo,DNS:localhost,IP:127.0.0.1"
for host in "$@"; do
  if [[ $host =~ ^[0-9.]+$ || $host == *:* ]]; then san+=",IP:$host"; else san+=",DNS:$host"; fi
done
cat > secrets/server.cnf <<EOF
[server]
basicConstraints = critical,CA:FALSE
keyUsage = critical,digitalSignature
extendedKeyUsage = serverAuth,clientAuth
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid,issuer
subjectAltName = $san
EOF
ossl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out server.key
ossl req -new -key server.key -subj /CN=mongo -out server.csr
ossl x509 -req -in server.csr -CA ca.pem -CAkey ca.key -CAcreateserial -days 825 \
  -extfile server.cnf -extensions server -out server.crt
cat secrets/server.crt secrets/server.key > secrets/server.pem
rm secrets/server.key secrets/server.csr secrets/server.crt secrets/server.cnf

# mongod gets the certificate through env (see start-mongod.sh).
grep -v '^MONGO_TLS_PEM_B64=' secrets/mongo.env > secrets/mongo.env.tmp || true
echo "MONGO_TLS_PEM_B64=$(base64 < secrets/server.pem | tr -d '\n')" >> secrets/mongo.env.tmp
mv secrets/mongo.env.tmp secrets/mongo.env
chmod 600 secrets/*
chmod 644 secrets/ca.pem
echo "Issued server certificate for: $san"
