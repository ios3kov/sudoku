"""PIN policy stays separate from account passwords; exercise real Argon2."""
import pytest
from app import security
from argon2 import PasswordHasher


@pytest.mark.parametrize("pin", ["0000", "0007", "0123", "9999"])
def test_four_digit_pin_round_trip_without_weakening_password_policy(pin):
    encoded = security.hash_device_pin(pin)
    assert encoded.startswith("$argon2id$")
    assert "m=65536,t=3,p=4" in encoded
    assert security.verify_device_pin(encoded, pin)
    assert not security.verify_device_pin(encoded, "4321")
    assert not security.verify_password(encoded, pin)
    with pytest.raises(ValueError, match="at least 12"):
        security.hash_password(pin)


@pytest.mark.parametrize("pin", ["", "123", "12345", "12a4", "１２３４", "١٢٣٤", "123\n", " 123", "1234 "])
def test_rejects_invalid_pin_without_hashing(pin):
    with pytest.raises(ValueError, match="exactly four digits"):
        security.hash_device_pin(pin)
    assert not security.verify_device_pin("invalid-hash", pin)


def test_each_pin_verifier_has_an_independent_random_salt():
    first = security.hash_device_pin("0007")
    second = security.hash_device_pin("0007")
    assert first != second
    assert security.verify_device_pin(first, "0007")
    assert security.verify_device_pin(second, "0007")


def test_pin_verifier_is_not_a_password_verifier():
    # Even a raw Argon2 verifier for four digits is not in the PIN domain.
    raw_hash = PasswordHasher().hash("0007")
    assert not security.verify_device_pin(raw_hash, "0007")
    password = "a real account password"
    encoded = security.hash_password(password)
    assert security.verify_password(encoded, password)
    assert not security.verify_device_pin(encoded, "0007")


@pytest.mark.parametrize("encoded", ["", "not-argon2", "$argon2id$v=19$m=65536,t=3,p=4$broken$broken"])
def test_corrupt_pin_verifiers_fail_closed(encoded):
    assert not security.verify_device_pin(encoded, "0007")
