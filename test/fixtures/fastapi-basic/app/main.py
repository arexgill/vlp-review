from fastapi import FastAPI, Depends
from pydantic import BaseModel

app = FastAPI()

class Item(BaseModel):
    name: str

def get_db():
    pass

@app.get('/items/{item_id}', response_model=Item, status_code=200)
def read_item(item_id: int, item: Item, db=Depends(get_db)):
    return {"name": "test"}

@app.exception_handler(404)
async def custom_404_handler(request, exc):
    return {"message": "Not found"}
