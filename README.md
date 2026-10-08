# Meeting Note

Ứng dụng ghi chú họp local-first cho PC và Android. Dữ liệu được lưu trong trình duyệt trên chính thiết bị, không cần tài khoản hay server.

## Chạy trên PC

Trong thư mục này, chạy:

```powershell
python -m http.server 4173
```

Sau đó mở `http://localhost:4173` trên Chrome hoặc Edge. Ở lần đầu, trình duyệt sẽ hỏi quyền microphone khi ghi âm.

## Dùng trên Android

Đưa thư mục này lên một web host tĩnh có HTTPS, mở đường link bằng Chrome Android, rồi chọn **Install app** / **Cài đặt ứng dụng** trong trình duyệt. Ứng dụng hoạt động offline sau lần tải đầu.

## Hiện có

- Tạo và tìm cuộc họp; agenda/câu hỏi có thể thêm trước hoặc trong họp.
- Ghi chú, đánh dấu quyết định, việc cần làm và nội dung quan trọng.
- Ghi âm microphone vào cuộc họp hiện tại.
- Chụp/đính ảnh và ghi chú hiện trường.
- Tạo tóm tắt cục bộ từ ghi chú; xuất PDF bằng hộp thoại in, xuất Word, chia sẻ và mở email draft.

## Chưa tích hợp ở bản MVP

Transcript bằng Whisper và tóm tắt bằng Ollama chưa được nối trực tiếp. UI và nơi lưu audio đã sẵn sàng để tích hợp AI local ở bước kế tiếp.
