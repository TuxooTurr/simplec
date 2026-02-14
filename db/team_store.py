"""
TeamStore — хранилище команд из БД.
"""

import json
import os

TEAMS_FILE = os.path.join(
    os.path.dirname(__file__), "..", "data", "teams.json"
)


class TeamStore:
    """Управление списком команд."""

    @staticmethod
    def _ensure_file():
        os.makedirs(os.path.dirname(TEAMS_FILE), exist_ok=True)
        if not os.path.exists(TEAMS_FILE):
            default = [
                {
                    "id": "00G10014",
                    "name": "Канальный агент и агенты эксперты",
                    "display": "Канальный агент и агенты эксперты [00G10014]"
                }
            ]
            with open(TEAMS_FILE, "w", encoding="utf-8") as f:
                json.dump(default, f, ensure_ascii=False, indent=2)

    @staticmethod
    def get_teams():
        TeamStore._ensure_file()
        with open(TEAMS_FILE, "r", encoding="utf-8") as f:
            return json.load(f)

    @staticmethod
    def get_display_list():
        teams = TeamStore.get_teams()
        return [t["display"] for t in teams]

    @staticmethod
    def add_team(team_id, name):
        teams = TeamStore.get_teams()
        display = name + " [" + team_id + "]"
        for t in teams:
            if t["id"] == team_id:
                return
        teams.append({
            "id": team_id,
            "name": name,
            "display": display
        })
        with open(TEAMS_FILE, "w", encoding="utf-8") as f:
            json.dump(teams, f, ensure_ascii=False, indent=2)

