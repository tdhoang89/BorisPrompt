# Hệ Mặt Trời Tương Tác

Mô hình 3D Hệ Mặt Trời chạy trong trình duyệt. Mỗi thiên thể nằm đúng vị trí của nó tại thời điểm đang hiển thị.

## Mở

Mở `index.html` bằng Chrome, Edge, Firefox hoặc Safari bản mới (cần WebGL 2 và kết nối mạng để tải three.js và phông chữ). Không cần cài gì thêm.

## Có gì bên trong

- Mặt Trời, 8 hành tinh, Sao Diêm Vương, 14 vệ tinh lớn, sao chổi Halley, vành đai tiểu hành tinh (kèm hai cụm Troia của Sao Mộc), vành đai Kuiper, 5.044 ngôi sao thật và 88 chòm sao.
- Hai chế độ tỉ lệ: Trực quan (khoảng cách nén, hành tinh phóng to) và Tỉ lệ thật (có thước đo km và thời gian ánh sáng).
- Điều khiển thời gian từ −1 năm/giây đến +1 năm/giây, chọn ngày bất kỳ (1800–2199), các sự kiện: nhật thực 2026 và 2027, nguyệt thực 2026, Sao Hỏa gần nhất 2003, giao hội Mộc–Thổ 2020, vành Sao Thổ nằm ngang 2025, Halley qua cận điểm 1986.
- Bảng thông tin cho từng thiên thể: số liệu NASA, khoảng cách và tốc độ ở thời điểm đang xem, pha trăng, mùa, cân nặng và tuổi của bạn trên thiên thể đó.
- Chuyến tham quan tự động; phím tắt `0`–`9`, `Space`, `←` `→`, `T`, `R`, `L`, `O`, `Esc`.

## Độ chính xác

- Hành tinh và Halley: phần tử quỹ đạo Kepler của JPL (Standish), chính xác nhất trong khoảng 1800–2050. Halley chỉ tính lực hút Mặt Trời.
- Mặt Trăng: lịch thiên văn rút gọn (sai số dưới khoảng 0,3°), đủ để nhật thực và nguyệt thực xảy ra đúng lúc và đúng nơi.
- Trục quay và kinh tuyến gốc theo IAU 2015; Trái Đất quay theo giờ sao Greenwich, nên mặt ngày/đêm khớp giờ thật.
- Bóng nhật thực, nguyệt thực, bóng vành Sao Thổ được tính theo hình học thật ở cả hai chế độ tỉ lệ.
- Vị trí các vệ tinh khác Mặt Trăng là gần đúng (đúng chu kỳ, pha ban đầu ước lượng).
- Bề mặt hành tinh được vẽ thủ tục trên GPU. Đường bờ biển Trái Đất lấy từ Natural Earth; các vùng tối/sáng chính trên Mặt Trăng và Sao Hỏa đặt theo tọa độ thật; phần còn lại là diễn họa.

## Tệp

- `index.html`: giao diện và CSS.
- `js/app.js`: cảnh 3D, thiên văn, tương tác.
- `js/shaders.js`: shader GLSL (bề mặt, khí quyển, vành, bóng).
- `js/data.js`: số liệu và lời giới thiệu từng thiên thể.
- `data/earth.js`: mặt nạ lục địa (Natural Earth 1:50m, phạm vi công cộng).
- `data/sky.js`: sao đến cấp 6 và đường chòm sao (cơ sở dữ liệu HYG qua d3-celestial, giấy phép BSD-3).
