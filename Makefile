.PHONY: install dev test e2e kill-port
install:
	python3 -m pip install -r requirements.txt
	python3 -m pip install -e .
dev:
	scripts/dev.sh
test:
	pytest -q
e2e:
	scripts/e2e.sh
kill-port:
	P=${PORT:-8080}; PIDS="$$(lsof -ti tcp:$$P || true)"; [ -z "$$PIDS" ] || kill $$PIDS
