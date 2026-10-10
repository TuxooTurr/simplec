"""
Запуск MCP-сервера SimpleTest.

  python -m mcp_server                 # stdio — так его запускает GigaCode
  python -m mcp_server --http          # streamable HTTP на 127.0.0.1:8765/mcp
  python -m mcp_server --http --port 9000

В HTTP-режиме один процесс держит браузер, а подключаться могут несколько клиентов
(GigaCode, сам SimpleTest). Два stdio-процесса одновременно не уживутся: профиль
браузера можно открыть только одним процессом.
"""

import argparse

from .server import mcp


def main() -> None:
    parser = argparse.ArgumentParser(prog="python -m mcp_server", description="MCP-сервер SimpleTest")
    parser.add_argument("--http", action="store_true", help="streamable HTTP вместо stdio")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    if args.http:
        mcp.run(transport="streamable-http", host=args.host, port=args.port)
    else:
        mcp.run()


if __name__ == "__main__":
    main()
