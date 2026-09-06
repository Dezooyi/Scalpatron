#!/usr/bin/env python3
"""Small local TimesFM 2.5 HTTP worker for Scalpatron's advisor."""

import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import numpy as np
import timesfm

MODEL = timesfm.TimesFM_2p5_200M_torch.from_pretrained(
    os.getenv("TIMESFM_CHECKPOINT", "google/timesfm-2.5-200m-pytorch")
)
MODEL.compile(
    timesfm.ForecastConfig(
        max_context=int(os.getenv("TIMESFM_CONTEXT_LENGTH", "128")),
        max_horizon=int(os.getenv("TIMESFM_HORIZON", "12")),
        normalize_inputs=True,
        use_continuous_quantile_head=False,
    )
)


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/health":
            self._json({"status": "ok", "model": "timesfm-2.5-pytorch"})
            return
        self.send_error(404)

    def do_POST(self):
        if self.path != "/forecast":
            self.send_error(404)
            return
        try:
            length = int(self.headers.get("content-length", "0"))
            payload = json.loads(self.rfile.read(length))
            series = np.asarray(payload["series"], dtype=np.float32)
            horizon = min(int(payload.get("horizon", 12)), int(os.getenv("TIMESFM_HORIZON", "12")))
            if series.ndim != 1 or len(series) < 32 or not np.isfinite(series).all():
                raise ValueError("series must be a finite 1D array with at least 32 values")

            point_forecast, _ = MODEL.forecast(
                horizon=horizon,
                inputs=[series[-int(os.getenv("TIMESFM_CONTEXT_LENGTH", "128")):]],
            )
            forecast = np.asarray(point_forecast[0], dtype=np.float64).tolist()
            self._json({"forecast": forecast, "contextLength": len(series)})
        except (KeyError, TypeError, ValueError, json.JSONDecodeError) as error:
            self._json({"error": str(error)}, status=400)
        except Exception as error:
            self._json({"error": str(error)}, status=500)

    def _json(self, body, status=200):
        encoded = json.dumps(body).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def log_message(self, format, *args):
        return


if __name__ == "__main__":
    port = int(os.getenv("TIMESFM_PORT", "8001"))
    print(f"TimesFM worker listening on 127.0.0.1:{port}", flush=True)
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
