"""Web Push without extra libraries: VAPID keys (RFC 8292) and message encryption aes128gcm (RFC 8291, RFC 8188).
Only `cryptography` (comes with python-jose[cryptography]) and httpx are used.
The encryption is checked against the example from RFC 8291, Appendix A: backend/tests/test_webpush.py."""
from __future__ import annotations

import base64
import json
import os
import struct
import time
from pathlib import Path
from urllib.parse import urlsplit

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.hmac import HMAC

# Push services of the browsers. The server sends requests only there: the address comes from the user's browser,
# so without this list anyone could make the server call an arbitrary address.
PUSH_HOSTS = (
    "fcm.googleapis.com", "android.googleapis.com",   # Chrome, Edge on Android, Yandex Browser, Opera
    "updates.push.services.mozilla.com",              # Firefox
    "push.apple.com",                                 # Safari, iPhone (web.push.apple.com)
    "notify.windows.com",                             # Edge on Windows (*.notify.windows.com)
)


def b64u(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def unb64u(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def endpoint_allowed(endpoint: str) -> bool:
    try:
        u = urlsplit(endpoint)
    except ValueError:
        return False
    host = (u.hostname or "").lower()
    return u.scheme == "https" and any(host == h or host.endswith("." + h) for h in PUSH_HOSTS)


# ---------- keys ----------

def raw_public(key: ec.EllipticCurvePrivateKey) -> bytes:
    return key.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)


def private_from_raw(d: bytes) -> ec.EllipticCurvePrivateKey:
    return ec.derive_private_key(int.from_bytes(d, "big"), ec.SECP256R1())


def load_or_create_vapid(value: str, path: Path) -> ec.EllipticCurvePrivateKey:
    """VAPID_PRIVATE_KEY from .env (base64url of 32 bytes or PEM); empty -> a key saved once in the uploads volume,
    so it survives restarts and rebuilds. Changing the key makes every subscription stop working."""
    value = (value or "").strip()
    if value:
        if "BEGIN" in value:
            return serialization.load_pem_private_key(value.replace("\\n", "\n").encode(), password=None)  # type: ignore[return-value]
        return private_from_raw(unb64u(value))
    if path.exists():
        return serialization.load_pem_private_key(path.read_bytes(), password=None)  # type: ignore[return-value]
    key = ec.generate_private_key(ec.SECP256R1())
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
    os.chmod(path, 0o600)
    return key


def vapid_header(key: ec.EllipticCurvePrivateKey, endpoint: str, subject: str, now: int | None = None) -> str:
    """Authorization header: a JWT (ES256) for the origin of the push service + the public key."""
    u = urlsplit(endpoint)
    claims = {"aud": f"{u.scheme}://{u.netloc}", "exp": int(now or time.time()) + 12 * 3600, "sub": subject}
    head = b64u(json.dumps({"typ": "JWT", "alg": "ES256"}, separators=(",", ":")).encode())
    body = b64u(json.dumps(claims, separators=(",", ":")).encode())
    der = key.sign(f"{head}.{body}".encode(), ec.ECDSA(hashes.SHA256()))
    r, s = decode_dss_signature(der)
    sig = b64u(r.to_bytes(32, "big") + s.to_bytes(32, "big"))
    return f"vapid t={head}.{body}.{sig}, k={b64u(raw_public(key))}"


# ---------- encryption ----------

def _hmac(key: bytes, data: bytes) -> bytes:
    h = HMAC(key, hashes.SHA256())
    h.update(data)
    return h.finalize()


def _hkdf(salt: bytes, ikm: bytes, info: bytes, n: int) -> bytes:
    prk = _hmac(salt, ikm)
    return _hmac(prk, info + b"\x01")[:n]  # n <= 32: one block of HKDF-Expand is enough


def encrypt(payload: bytes, p256dh: str, auth: str, salt: bytes | None = None,
            server_key: ec.EllipticCurvePrivateKey | None = None, rs: int = 4096) -> bytes:
    """Body of the push request (Content-Encoding: aes128gcm), one record.
    salt and server_key are given only by the test; normally they are new for every message."""
    ua_public = unb64u(p256dh)
    auth_secret = unb64u(auth)
    if len(ua_public) != 65 or len(auth_secret) != 16:
        raise ValueError("bad subscription keys")
    salt = salt or os.urandom(16)
    as_key = server_key or ec.generate_private_key(ec.SECP256R1())
    as_public = raw_public(as_key)
    ua_key = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), ua_public)
    ecdh = as_key.exchange(ec.ECDH(), ua_key)
    ikm = _hkdf(auth_secret, ecdh, b"WebPush: info\x00" + ua_public + as_public, 32)
    cek = _hkdf(salt, ikm, b"Content-Encoding: aes128gcm\x00", 16)
    nonce = _hkdf(salt, ikm, b"Content-Encoding: nonce\x00", 12)
    if len(payload) + 1 + 16 > rs:
        raise ValueError("payload too long")
    cipher = AESGCM(cek).encrypt(nonce, payload + b"\x02", None)  # 0x02: the last (and only) record, no padding
    return salt + struct.pack("!IB", rs, len(as_public)) + as_public + cipher
