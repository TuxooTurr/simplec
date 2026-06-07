.PHONY: build test up down logs clean

build:
	cd server && ./gradlew bootJar
	cd dashboard && npm run build

test:
	cd server && ./gradlew test

up:
	docker compose up -d --build

down:
	docker compose down

logs:
	docker compose logs -f

clean:
	cd server && ./gradlew clean
	cd dashboard && rm -rf dist node_modules/.cache

server-dev:
	cd server && ./gradlew bootRun

dashboard-dev:
	cd dashboard && npm run dev

agent-android:
	bash agent/android/start-agent.sh

agent-ios:
	bash agent/ios/start-agent.sh
