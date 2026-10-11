# Showreel motion graphics 20 giây (1080×1920, 60fps)

**File để đăng TikTok:** `out/showreel_1080x1920.mp4`
**Ảnh bìa (cover):** `out/cover.png`

Toàn bộ hình ảnh và âm nhạc đều sinh ra bằng code: Python + Cairo vẽ vector, numpy tổng hợp âm thanh. Không dùng asset, sample hay nhạc có bản quyền.

## Đổi tên, handle, slogan

Sửa file `reel/config.json`:

```json
{
  "name": "BORIS",
  "role": "MOTION DESIGNER",
  "handle": "@boris.motion",
  "year": "2026",
  "cta": "OPEN FOR PROJECTS",
  "intro_words": ["MAKE", "THINGS", "MOVE"]
}
```

- `name`: tên lớn ở đoạn kết. Chữ cái đầu tiên được dùng làm logo trong cảnh vẽ trim path.
- `year`: camera zoom xuyên qua lỗ của chữ số 0. Nếu năm không có số 0, video sẽ dùng chữ số khác có lỗ (6, 8, 9).
- `intro_words`: ba từ mở đầu. Từ thứ ba nên dài hơn từ thứ hai để quả bóng nảy xuống được như cầu thang.
- File phải là JSON hợp lệ: giữ nguyên dấu ngoặc kép, không thêm chú thích.

Sau đó double-click `render.bat` (hoặc chạy `python reel/render.py`). Mất khoảng 7–8 phút trên máy 8 nhân. File `out/spectrum.npy` là dữ liệu phổ nhạc để thanh EQ nhảy theo nhạc thật, cứ để nguyên. Chữ dài sẽ tự co lại cho vừa khung.

## Các lệnh hữu ích

| Lệnh | Tác dụng |
|---|---|
| `python reel/render.py` | Bản cuối: nhạc + video, motion blur 6 sub-frame |
| `python reel/render.py --preview` | Bản nháp nhanh, nửa độ phân giải, không motion blur |
| `python reel/render.py --stills 3.2 10.5` | Xuất ảnh PNG tại các giây chỉ định |
| `python reel/render.py --sheet 0 20 0.25` | Contact sheet để soát cả video |
| `python reel/music.py` | Chỉ render nhạc (`out/music.wav`) |

## Cấu trúc 20 giây (120 BPM, mỗi ô nhịp = 2 giây)

| Giây | Cảnh | Chuyển sang cảnh sau bằng |
|---|---|---|
| 0–2 | Bóng nảy trên chữ MAKE / THINGS / MOVE, kèm chú thích squash/stretch và graph editor | Bóng thành dấu chấm, phóng to phủ kín màn hình |
| 2–4 | Morph hình khối: tròn → vuông → tam giác → sao, có echo trail | Ngôi sao kéo dài thành một thanh ngang |
| 4–6 | Kinetic type: 11 hàng chữ chạy, sóng đảo màu, hiệu ứng accordion | Camera zoom xuyên qua lỗ số 0 của "2026" |
| 6–7.4 | Đường hầm 3D bay xuyên qua | Bức tường xanh cuối hầm |
| 7.4–8 | Quả cầu 520 điểm xoay 3D | Các điểm tụ lại thành giọt chất lỏng |
| 8–10 | Metaball bóng bẩy, đếm ngược 3·2·1 (đoạn build) | Co sụp vào một điểm |
| 10–16 | DROP: confetti, grid wave, card flip, isometric, line terrain, thanh EQ chạy theo nhạc thật, vẽ logo bằng trim path, glitch, warp | Flash trắng |
| 16–18 | Tên rơi xuống, chữ đùn 3D nhiều lớp màu, các hình khối của cả video quay lại | — |
| 18–20 | Handle, nút CTA được con trỏ bấm, quả bóng bật ra từ nút | **Bóng đáp đúng khung hình đầu: video lặp liền mạch** |

Video được làm để TikTok tự lặp mà không lộ chỗ nối: âm thanh đuôi cuối được cuộn về đầu bài.
