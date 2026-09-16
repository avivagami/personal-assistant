/**
 * Everything the agent can touch, behind one interface. The real backend
 * talks to Google and Supabase. The injection test swaps in a fake so the
 * phishing experiment runs against a poisoned inbox with no real accounts.
 */
import * as gmail from "../google/gmail.js";
import * as calendar from "../google/calendar.js";
import * as drive from "../google/drive.js";
import * as memory from "../memory/store.js";
import * as gate from "../actions/gate.js";

export interface ToolBackend {
  searchMail: typeof gmail.searchMail;
  readMessage: typeof gmail.readMessage;
  readThread: typeof gmail.readThread;
  sentWithoutReply: typeof gmail.sentWithoutReply;
  listEvents: typeof calendar.listEvents;
  searchEvents: typeof calendar.searchEvents;
  searchDrive: typeof drive.searchDrive;
  remember: typeof memory.remember;
  completeFollowup: typeof memory.completeFollowup;
  deleteMemory: typeof memory.deleteMemory;
  resolveMemoryId: typeof memory.resolveMemoryId;
  memoryContext: typeof memory.memoryContext;
  propose: typeof gate.propose;
}

export const realBackend: ToolBackend = {
  searchMail: gmail.searchMail,
  readMessage: gmail.readMessage,
  readThread: gmail.readThread,
  sentWithoutReply: gmail.sentWithoutReply,
  listEvents: calendar.listEvents,
  searchEvents: calendar.searchEvents,
  searchDrive: drive.searchDrive,
  remember: memory.remember,
  completeFollowup: memory.completeFollowup,
  deleteMemory: memory.deleteMemory,
  resolveMemoryId: memory.resolveMemoryId,
  memoryContext: memory.memoryContext,
  propose: gate.propose,
};
