module.exports = {
  apps: [
    {
      name: "packet-oss",
      script: "pnpm",
      args: "start",
      cwd: __dirname,
      max_restarts: 10,
      min_uptime: "5s",
      restart_delay: 2000,
      kill_timeout: 5000,
      autorestart: true,
    },
    {
      name: "ssh-ws",
      script: "pnpm",
      args: "start:ssh-ws",
      cwd: __dirname,
      max_restarts: 10,
      min_uptime: "5s",
      restart_delay: 2000,
      autorestart: true,
    },
  ],
};
