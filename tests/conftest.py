import sys
import os
import types
import importlib.util

import pytest


def _install_fake_genlayer():
    """Inject a minimal fake `genlayer` module so the real contract imports."""
    m = types.ModuleType("genlayer")

    class u256(int):
        pass

    class TreeMap:
        def __class_getitem__(cls, item):
            return cls

        def __init__(self):
            self._d = {}

        def __getitem__(self, k):
            return self._d[k]

        def __setitem__(self, k, v):
            self._d[k] = v

        def __contains__(self, k):
            return k in self._d

    class _Return:
        def __init__(self, calldata):
            self.calldata = calldata

    def _passthrough(fn):
        return fn

    class _public:
        write = staticmethod(_passthrough)
        view = staticmethod(_passthrough)

    class _message:
        sender_address = "0x0000000000000000000000000000000000000000"

    class _web:
        @staticmethod
        def get(*a, **k):
            raise Exception("web disabled in tests")

        @staticmethod
        def render(*a, **k):
            raise Exception("web disabled in tests")

    class _nondet:
        web = _web

        @staticmethod
        def exec_prompt(*a, **k):
            return {}

    class _vm:
        Return = _Return

        @staticmethod
        def run_nondet_unsafe(leader_fn, validator_fn):
            return leader_fn()

    class _gl:
        Contract = object
        vm = _vm
        public = _public
        message = _message
        nondet = _nondet

    m.gl = _gl
    m.u256 = u256
    m.TreeMap = TreeMap
    sys.modules["genlayer"] = m
    return m


_install_fake_genlayer()

_HERE = os.path.dirname(os.path.abspath(__file__))
CONTRACT_PATH = os.path.normpath(os.path.join(_HERE, "..", "genlayer", "bounty_judge.py"))


def load_contract():
    spec = importlib.util.spec_from_file_location("contract_under_test", CONTRACT_PATH)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture(scope="session")
def contract():
    return load_contract()
