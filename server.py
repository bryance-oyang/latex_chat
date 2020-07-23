import asyncio
import websockets
import json
import datetime

class MessageNode(object):
  """Linked list node for messages.

  Stores messages and tracks whether it has been unlinked.
  """

  def __init__(self, message=None):
    self.message = message
    self.next = None
    self.unlinked = False

class MessageList(object):
  """Linked list for messages.

  Old messages at beginning, new messages at end.

  Has a limited capacity. When overfilled, it deletes old messages
  starting at beginning of list.
  """

  def __init__(self, capacity=2**16, max_nmsg=16):
    self.capacity = capacity
    self.max_nmsg = max_nmsg
    self.sentinal = MessageNode()
    self.tail = self.sentinal
    self.total_msg_len = 0
    self.nmsg = 0

  def push(self, message):
    # reject messages exceeding holding capacity
    if len(message) > self.capacity:
      return

    # clear old messages first to free up space
    self.total_msg_len += len(message)
    self.nmsg += 1
    self.prune()

    # add new message
    self.tail.next = MessageNode(message)
    self.tail = self.tail.next

  def prune(self):
    """Clears old messages until under capacity.
    """

    while self.total_msg_len > self.capacity or self.nmsg > self.max_nmsg:
      head = self.sentinal.next
      if head == None:
        return

      # unlink head from list
      if self.tail == head:
        self.tail = self.sentinal
      self.sentinal.next = head.next
      self.nmsg -= 1

      self.total_msg_len -= len(head.message)
      head.message = None
      head.unlinked = True

async def send_new_msg(websocket, msg_list, last_sent_node):
  """Sends all new messages to client.

  Will try to send all unsent messages until up to date.

  If timed out for so long that the last sent message has been
  erased from the msg_list, just send all the messages in the updated
  msg_list.
  """

  # if timed out for so long that last sent message is unlinked
  if last_sent_node.unlinked:
    last_sent_node = msg_list.sentinal

  while last_sent_node.next != None:
    cur_node = last_sent_node.next
    await websocket.send(cur_node.message)

    # if timed out for so long that last sent message is unlinked
    if cur_node.unlinked:
      last_sent_node = msg_list.sentinal
    else:
      last_sent_node = cur_node

  return last_sent_node

async def update_username_list(websocket, username_list):
  """Update client with currently connected users.
  """

  decoded_message = {"type":"update_username_list", "username_list":list(username_list.values())}
  raw_message = json.dumps(decoded_message)
  await websocket.send(raw_message)

async def handle_msg(websocket, ping_board, msg_list, username_list, decoded_message):
  # do not allow unregistered/unnamed users send messages
  if websocket not in username_list:
    return

  msg = str(decoded_message.get("msg", ""))
  if (msg == ""):
      return

  timestamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
  msg_list.push(json.dumps({"type":"msg", "username":username_list[websocket], "msg":msg, "timestamp":timestamp}))

  # ping all talkers
  for user in ping_board:
    await ping_board[user].put("msg")

async def register_username(websocket, ping_board, username_list, decoded_message):
  # prevent double registration
  if websocket in username_list:
    return

  global max_username_len
  global next_unused_user_id

  if decoded_message == None:
    username = "ducky"
  else:
    username = str(decoded_message.get("username", "ducky"))[:max_username_len]
    username = username.replace(" ", "_").lower()
  username_list[websocket] = username + ("_%02d" % next_unused_user_id)
  next_unused_user_id = (next_unused_user_id + 1) % 100

  # bring new user up to date with prev messages
  await ping_board[websocket].put("msg");

  # notify other users of new user
  for user in ping_board:
    await ping_board[user].put("update_username_list")

async def listen(websocket, ping_board, msg_list, username_list):
  """Listens to client for messages and parses them.

  When receiving a message, add to msg_list and ping all talkers,
  so they know there is a new message in the msg_list
  """

  while True:
    raw_message = await websocket.recv()
    decoded_message = json.loads(raw_message)
    message_type = decoded_message.get("type", "")

    if message_type == "msg":
      await handle_msg(websocket, ping_board, msg_list, username_list, decoded_message)
    elif message_type == "register_username":
      await register_username(websocket, ping_board, username_list, decoded_message)

async def talk(websocket, ping_board, msg_list, username_list):
  """Talks to client.

  Pinged when ping_board[websocket] is updated, which occurs
  when a new message appears in msg_list or new user joins.
  """

  last_sent_node = msg_list.sentinal
  while True:
    # halt until pinged
    ping = await ping_board[websocket].get()
    
    if ping == "init":
      pass;
    elif ping == "msg":
      last_sent_node = await send_new_msg(websocket, msg_list, last_sent_node)
    elif ping == "update_username_list":
      await update_username_list(websocket, username_list)





max_nuser = 32
max_username_len = 16
msg_list = MessageList(capacity=2**16, max_nmsg=16)
username_list = {}
ping_board = {}
next_unused_user_id = 0




async def client_handler(websocket, path):
  """When a new client connects, creates talker and listener for client.

  Also registers username and notifies others of new user.
  """

  global ping_board
  global max_nuser

  if len(ping_board) >= max_nuser:
    print("[user_count %02d] overcapacity: connection refused" % len(ping_board))
    return

  global next_unused_user_id
  global msg_list
  global username_list
  global max_username_len


  # setup new user
  ping_board[websocket] = asyncio.Queue()
  await ping_board[websocket].put("init")
  print("[user_count %02d] new connection" % len(ping_board))

  talker = None
  try:
    listener = asyncio.create_task(listen(websocket, ping_board, msg_list, username_list))
    talker = asyncio.create_task(talk(websocket, ping_board, msg_list, username_list))
    await asyncio.gather(listener, talker)
  except websockets.exceptions.ConnectionClosed:
    pass
  finally:
    if talker != None:
      talker.cancel()
    if websocket in username_list:
      del username_list[websocket]
    if websocket in ping_board:
      del ping_board[websocket]

    # notify other users of disconnect
    for user in ping_board:
      await ping_board[user].put("update_username_list")

    print("[user_count %02d] disconnect" % len(ping_board))

start_server = websockets.serve(client_handler, "localhost", 9999)
loop = asyncio.get_event_loop()
loop.run_until_complete(start_server)
loop.run_forever()
