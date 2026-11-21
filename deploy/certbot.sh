#!/bin/sh
set -eu

case "${HTTPS_ENABLED:-false}" in
    true) ;;
    false)
        echo "HTTPS is disabled; Certbot will not issue or renew certificates."
        exec sleep infinity
        ;;
    *) echo "HTTPS_ENABLED must be true or false." >&2; exit 1 ;;
esac

: "${HTTPS_IP:?HTTPS_IP is required}"

if [ -n "${LETSENCRYPT_EMAIL:-}" ]; then
    set -- --email "$LETSENCRYPT_EMAIL"
else
    set -- --register-unsafely-without-email
fi

# This container does not need access to the Docker socket. Nginx detects
# certificate changes in the shared volume and reloads itself.
trap 'exit 0' TERM INT

while :; do
    delay=43200
    if [ -f "/etc/letsencrypt/renewal/$HTTPS_IP.conf" ]; then
        if ! certbot renew --non-interactive --cert-name "$HTTPS_IP"; then
            echo "Certificate renewal failed; retrying in 5 minutes." >&2
            delay=300
        fi
    else
        if ! certbot certonly \
            --non-interactive \
            --agree-tos \
            "$@" \
            --webroot \
            --webroot-path /var/www/certbot \
            --preferred-profile shortlived \
            --ip-address "$HTTPS_IP" \
            --cert-name "$HTTPS_IP"; then
            echo "Certificate issuance failed; check public port 80. Retrying in 5 minutes." >&2
            delay=300
        fi
    fi

    # Background sleep lets the shell handle Docker's stop signal promptly.
    sleep "$delay" &
    wait "$!"
done
