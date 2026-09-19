from app.security import hash_password,new_token,token_digest,verify_password
def test_password_hash_roundtrip():
    digest=hash_password("correct horse battery staple")
    assert digest!="correct horse battery staple"
    assert verify_password(digest,"correct horse battery staple")
    assert not verify_password(digest,"wrong password")
def test_tokens_are_random_and_stored_as_digest():
    a,b=new_token(),new_token()
    assert a!=b and len(token_digest(a))==32 and token_digest(a)!=token_digest(b)
