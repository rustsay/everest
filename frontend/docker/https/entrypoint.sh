#!/bin/sh
set -eu

case "${HTTPS_ENABLED:-false}" in
    true|false) ;;
    *) echo "HTTPS_ENABLED must be true or false." >&2; exit 1 ;;
esac

: "${HTTPS_IP:=144.31.194.150}"
export HTTPS_IP

# Restrict template input to an IPv4 address, including when set through .env.
if ! printf '%s\n' "$HTTPS_IP" | awk -F. '
    NF != 4 { exit 1 }
    { for (i = 1; i <= NF; i++)
        if ($i !~ /^[0-9]+$/ || length($i) > 3 || $i > 255 || (length($i) > 1 && substr($i, 1, 1) == "0")) exit 1 }
'; then
    echo "HTTPS_IP must be a public IPv4 address." >&2
    exit 1
fi

cert_dir="/etc/letsencrypt/live/$HTTPS_IP"

certificate_state() {
    if [ -s "$cert_dir/fullchain.pem" ] && [ -s "$cert_dir/privkey.pem" ]; then
        cksum "$cert_dir/fullchain.pem" "$cert_dir/privkey.pem" || printf 'pending\n'
    else
        printf 'pending\n'
    fi
}

render_config() {
    template=http.conf.template
    if [ "${HTTPS_ENABLED:-false}" = true ] && [ -s "$cert_dir/fullchain.pem" ] && [ -s "$cert_dir/privkey.pem" ]; then
        template=https.conf.template
    fi
    # Leave Nginx variables such as $host and $scheme intact.
    envsubst '${HTTPS_IP}' < "/opt/everest-https/$template" > /etc/nginx/conf.d/default.conf.tmp
    mv /etc/nginx/conf.d/default.conf.tmp /etc/nginx/conf.d/default.conf
}

state=$(certificate_state)
render_config

if [ "${HTTPS_ENABLED:-false}" = false ]; then
    echo "HTTPS is disabled; serving HTTP without monitoring certificates."
    exec /docker-entrypoint.sh "$@"
fi

(
    while sleep 30; do
        next_state=$(certificate_state)
        if [ "$next_state" != "$state" ]; then
            render_config
            if nginx -t && nginx -s reload; then
                state=$next_state
                echo "Nginx loaded the updated HTTPS certificate."
            else
                echo "Nginx could not load the certificate; retrying in 30 seconds." >&2
            fi
        fi
    done
) &

exec /docker-entrypoint.sh "$@"
