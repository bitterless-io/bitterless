import { parse, type Type } from 'protobufjs';
import type { ZellijNativeClientMessage, ZellijNativeServerMessage } from './zellijNativeIpc.type';

/**
 * Projection of Zellij 0.45.1, contract_version_1. Field numbers and ExitReason values come from
 * https://github.com/zellij-org/zellij/blob/v0.45.1/zellij-utils/assets/prost_ipc/client_server_contract.rs
 * Unused message variants remain opaque bytes, retaining their oneof identity for proxy routing.
 * protobufjs owns protobuf encoding/decoding; IPC adds the native four-byte little-endian length.
 */
const schema = parse(`syntax = "proto3";
message Empty {}
message Size { uint32 cols = 1; uint32 rows = 2; }
message LayoutInfo {
  oneof layout { string file_path = 1; string builtin_name = 2; string url = 3; string stringified = 4; }
}
message CliAssets {
  optional string config_file_path = 1;
  optional string config_dir = 2;
  bool should_ignore_config = 3;
  LayoutInfo layout = 5;
  Size terminal_window_size = 6;
  optional string data_dir = 7;
  bool is_debug = 8;
  optional uint32 max_panes = 9;
  bool force_run_layout_commands = 10;
  optional string cwd = 11;
  map<string, string> host_terminal_env = 12;
}
message FirstClientConnected { CliAssets cli_assets = 1; bool is_web_client = 2; }
message ListPanes {
  bool show_tab = 1; bool show_command = 2; bool show_state = 3;
  bool show_geometry = 4; bool show_all = 5; bool output_json = 6;
}
message CurrentTabInfo { bool output_json = 1; }
message Action {
  oneof action { ListPanes list_panes = 98; CurrentTabInfo current_tab_info = 105; }
}
message ActionMsg {
  Action action = 1; optional uint32 terminal_id = 2;
  optional uint32 client_id = 3; bool is_cli_client = 4;
}
message Client {
  oneof message {
    bytes detach_session = 1; bytes terminal_pixel_dimensions = 2;
    bytes background_color = 3; bytes foreground_color = 4; bytes color_registers = 5;
    bytes terminal_resize = 6; FirstClientConnected first_client_connected = 7;
    bytes attach_client = 8; ActionMsg action = 9; bytes key = 10;
    Empty client_exited = 11; Empty kill_session = 12; Empty conn_status = 13;
    bytes web_server_started = 14; bytes failed_to_start_web_server = 15;
    bytes attach_watcher_client = 16; bytes subscribe_to_pane_renders = 17;
    bytes desktop_notification_response = 18; bytes forwarded_reply_from_host = 19;
    bytes host_terminal_theme_changed = 20; bytes soft_keyboard_visibility_changed = 21;
    bytes nested_session_frame_from_host = 22; bytes kitty_graphics_support = 23;
    bytes sixel_support = 24; bytes request_session_list = 25;
    bytes set_mobile_render_preferences = 26; bytes host_terminal_focus_changed = 27;
  }
}
message Log { repeated string lines = 1; }
message Exit { uint32 exit_reason = 1; optional string payload = 2; }
message Server {
  oneof message {
    bytes render = 1; Empty unblock_input_thread = 2; Exit exit = 3;
    Empty connected = 4; Log log = 5; Log log_error = 6;
    bytes switch_session = 7; bytes unblock_cli_pipe_input = 8; bytes cli_pipe_output = 9;
    bytes query_terminal_size = 10; bytes start_web_server = 11; bytes renamed_session = 12;
    bytes config_file_updated = 13; bytes pane_render_update = 14; bytes subscribed_pane_closed = 15;
    bytes forward_query_to_host = 16; bytes set_soft_keyboard = 17;
    bytes emit_nested_session_frame = 18; bytes mobile_state = 19;
  }
}
`).root;

const clientType = schema.lookupType('Client');
const serverType = schema.lookupType('Server');

const encodeFrame = (type: Type, message: object): Buffer => {
  const error = type.verify(message);
  if (error) throw new Error(`Invalid Zellij message: ${error}`);
  const created = type.create(message);
  if (typeof (created as unknown as { message?: string }).message !== 'string') {
    throw new Error('Missing Zellij message variant');
  }
  const payload = type.encode(created).finish();
  const header = Buffer.alloc(4);
  header.writeUInt32LE(payload.length);
  return Buffer.concat([header, payload]);
};

const decodeMessage = <T>(type: Type, payload: Uint8Array): T => {
  const decoded = type.decode(payload);
  const error = type.verify(decoded);
  if (error) throw new Error(`Invalid Zellij message: ${error}`);
  const variant = (decoded as unknown as { message?: string }).message;
  if (typeof variant !== 'string') throw new Error('Missing Zellij message variant');
  return { ...type.toObject(decoded), message: variant } as T;
};

export const encodeZellijClientMessage = (message: ZellijNativeClientMessage): Buffer =>
  encodeFrame(clientType, message);

export const encodeZellijServerMessage = (message: ZellijNativeServerMessage): Buffer =>
  encodeFrame(serverType, message);

export const decodeZellijClientMessage = (body: Uint8Array): ZellijNativeClientMessage =>
  decodeMessage(clientType, body);

export const decodeZellijServerMessage = (body: Uint8Array): ZellijNativeServerMessage =>
  decodeMessage(serverType, body);

export const isZellijConnStatusFrame = (body: Uint8Array): boolean =>
  decodeZellijClientMessage(body).message === 'connStatus';

export const encodeZellijConnectedFrame = (): Buffer =>
  encodeZellijServerMessage({ connected: {} });

export const encodeZellijExitFrame = (reason: string): Buffer =>
  encodeZellijServerMessage({ exit: { exitReason: 7, payload: reason } });

/** Incremental framing uses one bounded allocation per frame, including byte-at-a-time input. */
export class ZellijNativeFrameDecoder {
  private readonly header = Buffer.alloc(4);
  private headerBytes = 0;
  private payload: Buffer | null = null;
  private payloadBytes = 0;

  constructor(private readonly maxFrameBytes: number) {}

  get incomplete(): boolean {
    return this.headerBytes > 0 || this.payload !== null;
  }

  push(chunk: Buffer): Buffer[] {
    const frames: Buffer[] = [];
    let offset = 0;
    while (offset < chunk.length) {
      if (this.payload === null) {
        const copied = Math.min(4 - this.headerBytes, chunk.length - offset);
        chunk.copy(this.header, this.headerBytes, offset, offset + copied);
        this.headerBytes += copied;
        offset += copied;
        if (this.headerBytes < 4) continue;
        const length = this.header.readUInt32LE(0);
        if (length === 0 || length > this.maxFrameBytes) {
          throw new Error('Invalid Zellij IPC frame length');
        }
        this.headerBytes = 0;
        this.payload = Buffer.alloc(length);
      }
      const copied = Math.min(this.payload.length - this.payloadBytes, chunk.length - offset);
      chunk.copy(this.payload, this.payloadBytes, offset, offset + copied);
      this.payloadBytes += copied;
      offset += copied;
      if (this.payloadBytes === this.payload.length) {
        frames.push(this.payload);
        this.payload = null;
        this.payloadBytes = 0;
      }
    }
    return frames;
  }
}
