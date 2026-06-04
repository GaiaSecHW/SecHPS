#!/bin/bash

# 部署脚本
#set -e

if [[ -f "./images.env" ]]; then
  # shellcheck disable=SC1091
  source "./images.env"
fi

for file in ./*;
do
  if [[ "$file" =~ \.yaml$ ]]; then
    echo "$(date): start apply: ${file}"
    kubectl apply -f "${file}"
  fi
done

echo "done"
