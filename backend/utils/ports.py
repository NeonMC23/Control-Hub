import socket


def is_port_free(port: int, host: str = "127.0.0.1") -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            s.bind((host, int(port)))
            return True
        except OSError:
            return False


def pick_free_port(desired_port: int, host: str = "127.0.0.1", max_tries: int = 50) -> int:
    port = int(desired_port)
    for _ in range(max_tries):
        if is_port_free(port, host=host):
            return port
        port += 1
    raise RuntimeError("No free port found")

