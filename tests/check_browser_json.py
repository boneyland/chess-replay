"""
The video pipeline accepts the browser's analysis JSON. Run after `node --test tests/*.test.cjs`
(which writes tests/out/scholar_analysis.json, and tests/out/tb_analysis.json, a game the tablebase answered), from the repo root:
    ../chess-animator/.venv/bin/python -m unittest tests/check_browser_json.py
"""
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2] / "chess-animator"  # the Python project, checked out next to this repo
sys.path.insert(0, str(ROOT))
from animator_game import AnalysisData  # noqa: E402

JSON = Path(__file__).parent / "out" / "scholar_analysis.json"
# KBN v K with every position from the tablebase (tests/tablebase-analysis.test.cjs): Python has no tablebase, so
# scholar_analysis.json (a run with it off) is the one compared; this one checks the extra fields and depth 0 load
TB_JSON = Path(__file__).parent / "out" / "tb_analysis.json"


# three lines a move from the real engine (tests/analysis-core.test.cjs): the same engine_lines shape chess_game_analyzer.py writes
LINES_JSON = Path(__file__).parent / "out" / "lines_analysis.json"
LINES_REF = Path(__file__).parent / "fixtures" / "lines_analysis.json"  # chess_game_analyzer.py --lines 3


class BrowserJsonTest(unittest.TestCase):
    def test_animator_loads_browser_analysis(self):
        data = AnalysisData.from_json_file(JSON)
        self.assertEqual(len(data.moves), 7)
        summary = data.engine_summary()
        # no depth limit: Python reports the depths the searches reached
        self.assertTrue(summary.startswith("Stockfish 19 lite (browser) · depth "), summary)
        self.assertIn("3s per position", summary)
        self.assertEqual(data.moves[-1].move_san, "Qxf7#")

    def test_animator_loads_tablebase_analysis(self):
        data = AnalysisData.from_json_file(TB_JSON)
        self.assertEqual([m.move_san for m in data.moves], ["Ke3", "Kd5", "Bd3", "Kc5"])
        self.assertEqual([m.classification for m in data.moves], ["best", "best", "blunder", "best"])
        self.assertTrue(all(m.search_depth == 0 for m in data.moves))
        self.assertTrue(data.engine_summary().startswith("Stockfish 19 lite (browser)"), data.engine_summary())

    def test_animator_loads_engine_lines(self):
        data = AnalysisData.from_json_file(LINES_JSON)
        self.assertEqual(len(data.moves), 7)
        self.assertTrue(all(m.search_lines == 3 for m in data.moves))

    def test_engine_lines_match_the_analyzers_shape(self):
        import json
        ours = json.loads(LINES_JSON.read_text())["moves"][0]
        ref = json.loads(LINES_REF.read_text())["moves"][0]
        self.assertLessEqual(set(ref), set(ours))  # the browser adds its own search stats
        for line in ours["engine_lines"] + ref["engine_lines"]:
            self.assertEqual(sorted(line), ["depth", "eval", "line", "move"])
            self.assertEqual(line["move"], line["line"][0])
            self.assertLessEqual(len(line["line"]), 12)
        self.assertEqual(ours["engine_lines"][0]["line"], ours["best_line"])
        self.assertEqual(ref["engine_lines"][0]["line"], ref["best_line"])


if __name__ == "__main__":
    unittest.main()
