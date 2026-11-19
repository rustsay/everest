"""Web Push encryption against the example of RFC 8291, Appendix A, and the VAPID signature."""
import json

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import encode_dss_signature

from app import webpush as wp

# RFC 8291, Appendix A
PLAIN = b"When I grow up, I want to be a watermelon"
AS_PRIVATE = "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw"
UA_PUBLIC = "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4"
SALT = "DGv6ra1nlYgDCS1FRnbzlw"
AUTH = "BTBZMqHH6r4Tts7J_aSIgg"
BODY = ("DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_y"
        "l95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN")


def test_rfc8291_example():
    key = wp.private_from_raw(wp.unb64u(AS_PRIVATE))
    body = wp.encrypt(PLAIN, UA_PUBLIC, AUTH, salt=wp.unb64u(SALT), server_key=key)
    assert wp.b64u(body) == BODY


def test_vapid_header_signature():
    key = ec.generate_private_key(ec.SECP256R1())
    h = wp.vapid_header(key, "https://fcm.googleapis.com/fcm/send/abc", "mailto:a@b.ru", now=1_700_000_000)
    t, k = h.removeprefix("vapid t=").split(", k=")
    head, body, sig = t.split(".")
    claims = json.loads(wp.unb64u(body))
    assert claims == {"aud": "https://fcm.googleapis.com", "exp": 1_700_000_000 + 12 * 3600, "sub": "mailto:a@b.ru"}
    raw = wp.unb64u(sig)
    pub = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), wp.unb64u(k))
    pub.verify(encode_dss_signature(int.from_bytes(raw[:32], "big"), int.from_bytes(raw[32:], "big")),
               f"{head}.{body}".encode(), ec.ECDSA(hashes.SHA256()))


def test_endpoint_allowed():
    assert wp.endpoint_allowed("https://fcm.googleapis.com/fcm/send/x")
    assert wp.endpoint_allowed("https://web.push.apple.com/QX")
    assert wp.endpoint_allowed("https://wns2-db5p.notify.windows.com/w/?token=1")
    assert not wp.endpoint_allowed("http://fcm.googleapis.com/x")
    assert not wp.endpoint_allowed("https://evil.com/fcm.googleapis.com")
    assert not wp.endpoint_allowed("https://fcm.googleapis.com.evil.com/x")
    assert not wp.endpoint_allowed("https://localhost:8000/api")
