from pymongo import MongoClient

uri = "mongodb://rmnganyane_db_user:<db_password>@ac-9vbuxul-shard-00-00.flyv1jy.mongodb.net:27017,ac-9vbuxul-shard-00-01.flyv1jy.mongodb.net:27017,ac-9vbuxul-shard-00-02.flyv1jy.mongodb.net:27017/?ssl=true&replicaSet=atlas-60d03p-shard-0&authSource=admin&compressors=zlib"

try:
    client = MongoClient(uri)
    client.admin.command("ping")
    print("Connected successfully to MongoDB!")
    client.close()
except Exception as e:
    print("The following error occurred:", e)