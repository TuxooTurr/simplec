from __future__ import annotations

import argparse
import json

from simplec.app.pipeline import run_pipeline, PipelineInput
from simplec.app.services.features import register_feature, resolve_feature_name


def cmd_feature_add(args: argparse.Namespace) -> int:
    register_feature(code=args.code, name=args.name)
    print(f"OK: feature зарегистрирована: {args.code} = {args.name}")
    return 0


def cmd_generate(args: argparse.Namespace) -> int:
    feature_name = resolve_feature_name(args.feature) or args.feature_name or ""

    out = run_pipeline(
        PipelineInput(
            text=args.text,
            file_path=args.file,
            platform=args.platform,
            feature=args.feature,
        )
    )

    # допишем feature_name в report на уровне CLI (пока так, позже перенесём внутрь пайплайна)
    out.report["context"]["feature_name"] = feature_name

    print("=== REPORT (summary) ===")
    print(json.dumps(out.report, ensure_ascii=False, indent=2))
    print("\n=== OUTPUT DIR ===")
    print(out.out_dir)
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(prog="simplec")

    sub = parser.add_subparsers(dest="command", required=True)

    p_feat = sub.add_parser("feature", help="Управление справочником фич")
    sub_feat = p_feat.add_subparsers(dest="subcommand", required=True)
    p_add = sub_feat.add_parser("add", help="Добавить/обновить фичу")
    p_add.add_argument("--code", required=True, help="Сокращение фичи: AUTH, PAY_2, ...")
    p_add.add_argument("--name", required=True, help="Человеческое имя фичи")
    p_add.set_defaults(func=cmd_feature_add)

    p_gen = sub.add_parser("generate", help="Сгенерировать тесты")
    group = p_gen.add_mutually_exclusive_group(required=True)
    group.add_argument("--text", type=str, help="Требования текстом")
    group.add_argument("--file", type=str, help="Путь к файлу требований")
    p_gen.add_argument("--platform", type=str, default="W", help="W (web) или M (mobile)")
    p_gen.add_argument("--feature", type=str, default="GEN", help="Сокращение фичи: AUTH, PAY_2, ...")
    p_gen.add_argument("--feature-name", type=str, default="", help="Имя фичи (если нет в справочнике)")
    p_gen.set_defaults(func=cmd_generate)

    args = parser.parse_args()
    return int(args.func(args))


if __name__ == "__main__":
    raise SystemExit(main())
