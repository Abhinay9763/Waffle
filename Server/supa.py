import os
from typing import Optional

from dotenv import load_dotenv
from supabase import acreate_client,AClient

load_dotenv()
db_key = os.getenv("supa_key")
db_url = os.getenv("supa_url")
class DB:
    def __init__(self):
        self.client : Optional[AClient]= None
        pass

    async def connect(self):
        print("CONNECTING TO SUPA")
        self.client = await acreate_client(db_url, db_key)
        print(self.client)



db = DB()
