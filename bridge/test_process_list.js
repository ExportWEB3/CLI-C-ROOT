const WebSocket = require('ws');

const ws = new WebSocket('ws://localhost:8080');

ws.on('open', function open() {
  console.log('Connected to bridge');
  
  // Send a command to get process list
  // First, we need to know the client ID
  // Let's wait for client list
});

ws.on('message', function message(data) {
  const msg = JSON.parse(data.toString());
  console.log('Received:', msg.type || msg.topic);
  
  if (msg.type === 'client_list' && msg.clients && msg.clients.length > 0) {
    const clientId = msg.clients[0].id;
    console.log('Found client:', clientId);
    
    // Send PROCESS_LIST command
    const command = {
      topic: 'command',
      payload: {
        clientId: clientId,
        command: 'PROCESS_LIST'
      }
    };
    
    console.log('Sending command:', command);
    ws.send(JSON.stringify(command));
  }
  
  if (msg.type === 'process_list') {
    console.log('Process list received!');
    console.log('Number of processes:', msg.processes ? msg.processes.length : 0);
    if (msg.processes && msg.processes.length > 0) {
      console.log('First process:', msg.processes[0]);
    }
    ws.close();
  }
  
  if (msg.type === 'command_sent') {
    console.log('Command sent successfully');
  }
  
  if (msg.type === 'error') {
    console.log('Error:', msg.message);
    ws.close();
  }
});

ws.on('error', function error(err) {
  console.error('WebSocket error:', err);
});

ws.on('close', function close() {
  console.log('Disconnected from bridge');
});