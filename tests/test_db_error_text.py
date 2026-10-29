"""Понятная ошибка подключения к БД: причина из цепочки Java-исключений (getCause) и подсказка по корневой."""

from backend.api.db_connector import describe_db_error


class _Cls:
    def __init__(self, name):
        self.name = name

    def getName(self):
        return self.name


class JavaEx(Exception):
    """Подобие исключения из JPype: getClass / getMessage / getCause."""

    def __init__(self, name, msg=None, cause=None):
        super().__init__(msg or name)
        self._name, self._msg, self._cause = name, msg, cause

    def getClass(self):
        return _Cls(self._name)

    def getMessage(self):
        return self._msg

    def getCause(self):
        return self._cause


def psql(cause):
    return JavaEx("org.postgresql.util.PSQLException", "Ошибка при попытке подсоединения.", cause)


def test_причина_из_цепочки_и_подсказка():
    t = describe_db_error(psql(JavaEx("java.net.SocketTimeoutException", "Connect timed out")))
    assert t.startswith("PSQLException: Ошибка при попытке подсоединения. ← SocketTimeoutException: Connect timed out")
    assert "межсетевой экран" in t
    assert "DNS" in describe_db_error(psql(JavaEx("java.net.UnknownHostException", "db.local")))
    assert "sslmode" in describe_db_error(psql(JavaEx("java.io.EOFException")))


def test_подсказка_по_тексту_и_обычное_исключение():
    t = describe_db_error(JavaEx("org.postgresql.util.PSQLException", 'FATAL: password authentication failed for user "qa"'))
    assert "неверный логин или пароль" in t
    assert describe_db_error(ValueError("Драйвер не найден")) == "Драйвер не найден"


def test_зацикленная_цепочка_не_виснет():
    a = JavaEx("java.sql.SQLException", "a")
    a._cause = a
    assert describe_db_error(a) == "SQLException: a"
