import asyncio
import websockets

class MessageNode(object):
  """Linked list node for messages.

  Tracks whether it has been unlinked.
  """
  def __init__(self, message=None):
    self.message = message
    self.next = None
    self.unlinked = False

class MessageList(object):
  """Linked list for messages.

  Has a limited capacity. When overfilled, it deletes old messages
  starting at beginning of list.
  """
  def __init__(self, capacity):
    self.capacity = capacity
    self.sentinal = MessageNode()
    self.tail = self.sentinal
    self.total_msg_len = 0

  def push(self, message):
    # reject messages exceeding holding capacity
    if len(message) > self.capacity:
      return

    # clear old messages first to free up space
    self.total_msg_len += len(message)
    self.prune()

    # add new message
    self.tail.next = MessageNode(message)
    self.tail = self.tail.next

  def prune(self):
    while self.total_msg_len > self.capacity:
      head = self.sentinal.next
      if head == None:
        return

      # unlink head from list
      if self.tail == head:
        self.tail = self.sentinal
      self.sentinal.next = head.next

      self.total_msg_len -= len(head.message)
      head.message = None
      head.unlinked = True

connected_user = set()
msg_list = MessageList(2**16)
ping_board = {}

async def listen(websocket, msg_list):
  """Listens to client.

  When receiving a message, add to msg_list and ping all talkers,
  so they know there is a new message in the msg_list
  """
  while True:
    message = await websocket.recv()
    msg_list.push(message)

    # ping all talkers
    for user in ping_board:
      ping_board[user].set_result(b"derp")

async def talk(websocket, msg_list):
  """Talks to client.

  Pinged when a new message appears in msg_list.
  When pinged, will try to send all messages until up to date.

  If timed out for so long that the last sent message has been
  erased from the msg_list, just send all the messages in the updated
  msg_list.
  """
  last_sent_node = msg_list.sentinal
  while True:
    # await ping
    await ping_board[websocket]
    ping_board[websocket] = asyncio.Future()

    if last_sent_node.unlinked:
      last_sent_node = msg_list.sentinal

    while last_sent_node.next != None:
      cur_node = last_sent_node.next

      await websocket.send(cur_node.message)

      if cur_node.unlinked:
        last_sent_node = msg_list.sentinal
      else:
        last_sent_node = cur_node

async def client_handler(websocket, path):
  connected_user.add(websocket)
  print("connect: user_count %d" % len(connected_user))
  ping_board[websocket] = asyncio.Future()

  try:
    listener = asyncio.create_task(listen(websocket, msg_list))
    talker = asyncio.create_task(talk(websocket, msg_list))
    await asyncio.gather(listener, talker)
  except websockets.ConnectionClosedError:
    pass
  finally:
    del ping_board[websocket]
    connected.remove(websocket)
    print("disconnect: user_count %d" % len(connected_user))

start_server = websockets.serve(client_handler, "localhost", 9999)
loop = asyncio.get_event_loop()
loop.run_until_complete(start_server)
loop.run_forever()
