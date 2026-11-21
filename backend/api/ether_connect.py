from fastapi import APIRouter, Depends
from db.paths import MOCK
from backend.api.auth import require_user
from agents import ether_login, ether_mcp
router=APIRouter(prefix='/api/ether',tags=['Efir'],dependencies=[Depends(require_user)])

@router.get('/state')
def state():
    source=ether_mcp.credential_source()
    labels={'cookie':'Подключено через вход в браузере','env':'Настроено из окружения','broken':'Ошибка хранилища','none':'Не настроено'}
    return {**ether_login.state(),'source':source,'source_text':'Демо-подключение' if MOCK else labels[source], 'demo': MOCK}

@router.post('/connect')
def connect():
    ether_login.start();return state()

@router.delete('/connect')
def disconnect():
    ether_login.cancel();return state()
