module.exports = {
  proxy: "localhost:3000",
  files: ["public/**/*.*", "views/**/*.*"],
  ignore: ["node_modules"],
  reloadDelay: 1000,
  ui: false,
  notify: false,
  port: 3001,
  host: '0.0.0.0',
  open: false
}; 