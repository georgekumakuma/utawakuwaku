const express = require('express');
const path = require('path');
const app = express();
const port = 3000;
app.use(express.static(__dirname));
app.listen(port, () => {
  console.log(`Server running: http://localhost:${port}/`);
});
