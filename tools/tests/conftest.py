"""
A throwaway database per test, on the Postgres at TEST_DATABASE_URL
(postgres://postgres:postgres@localhost:5432/postgres by default), migrated with the same
migrations a deploy applies: web/scripts/migrate.mjs runs once into a template database,
and each test gets a copy of it.
"""

import os
import subprocess
import sys
import uuid
from urllib.parse import urlsplit, urlunsplit

import psycopg
import pytest

TOOLS = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, TOOLS)
WEB = os.path.join(os.path.dirname(TOOLS), "web")
BASE = os.environ.get("TEST_DATABASE_URL", "postgres://postgres:postgres@localhost:5432/postgres")


def _url(name):
    u = urlsplit(BASE)
    return urlunsplit(u._replace(path="/" + name))


def _admin(sql):
    with psycopg.connect(BASE, autocommit=True) as c:
        c.execute(sql)


@pytest.fixture(scope="session")
def template():
    name = f"tools_tpl_{os.getpid()}"
    _admin(f"drop database if exists {name}")
    _admin(f"create database {name}")
    subprocess.run(
        ["node", "scripts/migrate.mjs"],
        cwd=WEB,
        env={
            **{k: v for k, v in os.environ.items() if k != "DATABASE_URL_UNPOOLED"},
            "DATABASE_URL": _url(name),
        },
        check=True,
        capture_output=True,
    )
    yield name
    _admin(f"drop database if exists {name} with (force)")


@pytest.fixture
def db_url(template):
    name = "tools_test_" + uuid.uuid4().hex[:10]
    _admin(f"create database {name} template {template}")
    yield _url(name)
    _admin(f"drop database if exists {name} with (force)")


@pytest.fixture
def conn(db_url):
    with psycopg.connect(db_url, autocommit=True) as c:
        yield c
