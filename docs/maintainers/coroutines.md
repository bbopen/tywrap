# Coroutine calls

A `call` request returns one result or one error envelope. The bridge awaits a
Python awaitable before it serializes the result. It rejects generators and async
generators. It does not expose tasks, streams, retries, or cached results.

## Node subprocess

The Python JSONL server handles requests in order. A synchronous call runs
directly. For an awaitable result, `handle_call()` wraps it in a coroutine and
uses `asyncio.run()`. Python 3.10 through 3.12 create and close one event loop
for that call. Pending background tasks do not survive the call.

The call must return an awaitable that can run on this new loop. A Future bound
to another loop fails in the normal Python error envelope. A synchronous
function that needs a running loop before it returns must create that loop
itself or use an `async def` function.

After a request reaches stdin, a timeout or abort retires that Python process.
The transport rejects other requests on the same process and starts a new
process for later calls. Replacement runs the configured worker warmup. Python
state held only in the retired process is lost. A request that times out before
its first write does not retire the process.

Retirement sends SIGTERM first. If the child stays alive, it sends SIGKILL
after one second and waits for the child to exit. A failed kill blocks
replacement of that process generation.

Disposal kills the process and rejects pending requests. The caller receives
one timeout, abort, or disposal error. A retired process cannot send a late
response into a replacement process. A timeout does not cancel Python code in
place; process retirement stops code that does not cooperate with cancellation.

## Pyodide

Pyodide owns its [WebLoop](https://pyodide.org/en/0.28.1/usage/api/python-api/webloop.html).
The bootstrap registers a task by request ID before it returns the task to
JavaScript. The transport awaits the task and destroys its Pyodide proxies
after the task settles. Timeout, abort, and disposal call `Task.cancel()` for
that request. The task map removes settled and cancelled tasks.

Cancellation is cooperative. Python receives `CancelledError` at an await.
The caller receives one timeout, abort, or disposal error. The transport
consumes a late task rejection without sending another response.

CPU-bound Python on the browser thread can block both the JavaScript timer
and the Pyodide event loop. This transport cannot stop it at a deadline.
Pyodide documents [interrupt buffers](https://pyodide.org/en/0.28.1/usage/api/js-api.html#pyodide.setInterruptBuffer)
for web workers. The bridge does not install an interrupt buffer or terminate
a worker. Host applications must manage their own worker lifecycle if they
need that limit.
