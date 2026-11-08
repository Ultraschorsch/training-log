FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY index.html /usr/share/nginx/html/index.html
# nginx runs as user "nginx" – make sure it can read the files regardless of
# the permissions they had in the build context
RUN chmod 644 /etc/nginx/conf.d/default.conf /usr/share/nginx/html/index.html
