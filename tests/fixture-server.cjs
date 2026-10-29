const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
function startServer(port = 0) {
    return new Promise(resolve => {
        const server = http.createServer((req,res) => {
            res.setHeader('Cache-Control','no-store');
            if(req.url === '/favicon.ico'){res.writeHead(204);res.end();return;}
            if(req.url === '/fixture.js'){
                res.setHeader('Content-Type','text/javascript; charset=utf-8');
                res.end(fs.readFileSync(path.join(__dirname,'browser-fixture.js')));return;
            }
            res.setHeader('Content-Type','text/html; charset=utf-8');
            const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8')
                .replace(/<script src="https:\/\/www.gstatic.com\/firebasejs\/[^\"]+"><\/script>/g,'');
            res.end(html.replace('</head>','<script src="/fixture.js"></script></head>'));
        });
        server.listen(port,'127.0.0.1',()=>resolve(server));
    });
}
module.exports = {startServer};
if(require.main === module) startServer(Number(process.env.PORT || 4179)).then(server=>console.log(`Isolated preview: http://127.0.0.1:${server.address().port}`));
