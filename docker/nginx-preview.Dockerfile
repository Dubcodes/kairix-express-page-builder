FROM nginxinc/nginx-unprivileged:1.27-alpine

COPY docker/nginx-preview.conf /etc/nginx/conf.d/default.conf
