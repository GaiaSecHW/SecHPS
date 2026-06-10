import sys
import os
sys.path.append(os.getcwd())

from codedmap.utils.id_generator import generate_id

def test_collision():
    print("Testing ID generation...")
    ids = set()
    # 快速生成 10000 个 ID
    for _ in range(10000):
        new_id = generate_id()
        if new_id in ids:
            print(f"❌ COLLISION DETECTED! ID: {new_id}")
            return
        ids.add(new_id)
    print(f"✅ Generated {len(ids)} unique IDs successfully.")

if __name__ == "__main__":
    test_collision()