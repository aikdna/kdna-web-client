import client = require('@aikdna/kdna-web-client');
const selected:Promise<client.SelectionResult>=client.selectKDNA(new Uint8Array());
void selected;
