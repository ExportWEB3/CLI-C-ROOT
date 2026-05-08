const WebSocket = require('ws');
const ws = new WebSocket('ws://localhost:8080');

ws.on('open', () => {
    // try sending the get_clients msg
    ws.send(JSON.stringify({
        type: 'dashboard',
        query: 'get_clients',
        limit: 300,
        offset: 0,
        impersonateUserId: 2,
        token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIiwidXNlcm5hbWUiOiJhZG1pbiIsInJvbGUiOiJhZG1pbiIsImlhdCI6MTc3NzY0MTU1OSwiZXhwIjoxNzc3NzI3OTU5fQ==.RrbYfC4+SmUzLSPtoMiYJOyqlcUsawCkgY+2Lbw7hIc='
    }));

    ws.send(JSON.stringify({
        type: 'dashboard',
        query: 'get_keylog_status',
        impersonateUserId: 2,
        token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIiwidXNlcm5hbWUiOiJhZG1pbiIsInJvbGUiOiJhZG1pbiIsImlhdCI6MTc3NzY0MTU1OSwiZXhwIjoxNzc3NzI3OTU5fQ==.RrbYfC4+SmUzLSPtoMiYJOyqlcUsawCkgY+2Lbw7hIc='
    }));

    ws.send(JSON.stringify({
        type: 'dashboard',
        query: 'get_statistics',
        impersonateUserId: 2,
        token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIiwidXNlcm5hbWUiOiJhZG1pbiIsInJvbGUiOiJhZG1pbiIsImlhdCI6MTc3NzY0MTU1OSwiZXhwIjoxNzc3NzI3OTU5fQ==.RrbYfC4+SmUzLSPtoMiYJOyqlcUsawCkgY+2Lbw7hIc='
    }));

});

ws.on('message', (msg) => {
    console.log('MSG', msg.toString());
});
