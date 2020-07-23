"use strict";

// chat server connection
let websocket = null;
let registered = false;
let connected = false;

// react
let react_update_msg_area;
let msg_id_counter = 0;

class Msg extends React.Component {
  constructor(props) {
    super(props);

    // provides access to DOM node
    this.msg_ref = React.createRef();
  }

  // render latex 
  componentDidMount() {
    // DOM node for this
    const node = this.msg_ref.current;
    MathJax.typesetPromise([node]);
  }
  componentDidUpdate() {
  }
  shouldComponentUpdate(nextProps, nextState) {
    // old messages never change, so never rerender
    return false;
  }

  render() {
    return React.createElement("div", {"className":"msg_p"},
      React.createElement("span", {"className":"msg_timestamp"}, this.props["timestamp"] + " "),
      React.createElement("span", {"className":"msg_username"}, this.props["username"] + ": "),
      React.createElement("span", {"className":"msg_content", "ref":this.msg_ref}, this.props["content"])
    );
  }
}

class PrevMsgArea extends React.Component {
  constructor(props) {
    super(props);
    this.state = {"msg_list":[]};
  }

  componentDidMount() {
    // arrow functions don't need to .bind(this)
    // provides function to update state from outside react
    // really should be done with websocket at top level of app but whatever
    react_update_msg_area = (msg) => {
      this.setState((state) => {
        return {"msg_list":state["msg_list"].concat([msg])};
      });
    };
  }

  render() {
    const rendered_msg_list = this.state["msg_list"].map((msg, i) => {
      return React.createElement(Msg, {"key":msg["msg_id"], "className":"msg_p",
        "timestamp":msg["timestamp"],
        "username":msg["username"],
        "content":msg["content"]
      });
    });
    return React.createElement(React.Fragment, {}, rendered_msg_list);
  }
}

function submit_username() {
  let username = $("#username_input").val();
  if (username == "") {
    return;
  }

  let decoded_message = {"type":"register_username", "username":username};
  let message = JSON.stringify(decoded_message);

  if (!connected) {
    $("#enter_username_modal_error").html("<br><span style='color:red'>Connection Error</span>");
  } else {
    websocket.send(message);
    registered = true;
    $("#status").text("Connected");
    $("#status").css({"color":"green"});
    $("#enter_username_modal").modal("hide");
    $("#msg_area").focus();
  }
}

function update_username_list(decoded_message) {
  let username_list = decoded_message["username_list"] || "";
  $("#username_list").empty();
  for (let i = 0; i < username_list.length; i++) {
    let username_item = $("<div>");
    username_item.addClass("username_list_username");
    username_item.text(username_list[i]);
    $("#username_list").append(username_item);
  }
}

function update_prev_msg(decoded_message) {
  let timestamp = decoded_message["timestamp"] || "";
  let username = decoded_message["username"] || "";
  let content = decoded_message["msg"] || "";

  // update react state
  let msg = {"msg_id": msg_id_counter, "timestamp": timestamp, "username": username, "content":content};
  msg_id_counter++;
  react_update_msg_area(msg);

  // scroll to bottom
  $("#prev_msg").scrollTop($("#prev_msg")[0].scrollHeight);
}

function recv_mesg(event) {
  let decoded_message = JSON.parse(event.data);
  let type = decoded_message["type"] || "";
  if (type == "update_username_list") {
    update_username_list(decoded_message);
  } else if (type == "msg") {
    update_prev_msg(decoded_message);
  }
}

function send_msg() {
  if (!connected || !registered) {
    return;
  }

  let msg = $("#msg_area").val();
  if (msg == "") {
    return;
  }
  let decoded_message = {"type":"msg", "msg":msg}
  let message = JSON.stringify(decoded_message);
  websocket.send(message);
  $("#msg_area").val("");
  $("#msg_area").focus();
}

function get_username() {
  $("#status").text("Connecting...");
  $("#status").css({"color":"orange"});

  $("#enter_username_modal").modal({backdrop: "static", keyboard: false});
  $("#enter_username_modal").modal("show");
}

function open_websocket() {
  // don't open new connection if already open (websocket.onclose callback sets websocket to null)
  if (websocket != null) {
    return
  }
  registered = false;
  connected = false;

  websocket = new WebSocket("ws://localhost:9999/");
  websocket.onopen = function(event) {
    connected = true;
    $("#enter_username_modal_error").html("");
    get_username();
  }
  websocket.onerror = function(event) {
    registered = false;
    connected = false;
    $("#status").text("Error");
    $("#status").css({"color":"red"});
    websocket.close();
  }
  websocket.onclose = function(event) {
    // try to prevent the onclose logic from running more than once for each opened websocket
    if (websocket == null) {
      return;
    }

    registered = false;
    connected = false;
    $("#status").text("Not Connected");
    $("#status").css({"color":"red"});
    setTimeout(open_websocket, 3000);
    websocket = null;
  }
  websocket.onmessage = recv_mesg;
}


function chat_main() {
  // init global vars
  websocket = null;
  registered = false;
  connected = false;

  // some event listeners
  $("#enter_username_modal").on("shown.bs.modal", function () {
    $("#username_input").focus();
  });
  $("#username_input").on("keyup", function(event) {
    if (event.keyCode == 13) {
      submit_username();
    }
  });
  $("#msg_area").on("keyup", function(event) {
    if (event.keyCode == 13) {
      send_msg();
    }
  });

  // react things
  ReactDOM.render(React.createElement(PrevMsgArea, {}), $("#prev_msg")[0]);

  // connect to chat server
  open_websocket();
}

$(document).ready(chat_main);
