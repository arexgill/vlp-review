from fastapi import APIRouter, Depends

router = APIRouter()

def verify_token():
    pass

@router.api_route("/mixed", methods=["GET", "POST"], dependencies=[Depends(verify_token)])
def mixed_route():
    return {"message": "mixed"}
