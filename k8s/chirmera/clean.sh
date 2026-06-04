#!/bin/bash

# 清理脚本
#set -e

for file in $(ls ./*.yaml 2>/dev/null | sort -r);
do
  echo "$(date): start delete: ${file}"
  kubectl delete -f "${file}" --ignore-not-found=true
done

echo "done"
