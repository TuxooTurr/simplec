"""Cached service names discovered from the configured PVS namespace."""
import hashlib
import json
import os
import threading
import time
from tempfile import NamedTemporaryFile
from db.paths import DATA_DIR
FILE=DATA_DIR/'log_services.json'
LOCK=threading.RLock()

def scope():
    return hashlib.sha256('|'.join(os.getenv(k,'') for k in ('OPENSEARCH_URL','LOGS_PVS_INDEX','LOGS_MCP_NAMESPACE','LOGS_PVS_FIELDS')).encode()).hexdigest()

def load():
    try:
        data=json.loads(FILE.read_text(encoding='utf-8'))
        return data if data.get('scope')==scope() else {}
    except (FileNotFoundError,ValueError): return {}

def save(services):
    with LOCK:
        FILE.parent.mkdir(parents=True,exist_ok=True)
        with NamedTemporaryFile('w',dir=FILE.parent,encoding='utf-8',delete=False) as tmp:
            try:
                json.dump({'scope':scope(),'updatedAt':time.time(),'services':sorted(set(services),key=str.casefold)},tmp,ensure_ascii=False)
                tmp.close();os.replace(tmp.name,FILE)
            finally:
                if os.path.exists(tmp.name):os.unlink(tmp.name)

def fresh(data): return time.time()-data.get('updatedAt',0)<12*3600
