# zMinutes — UI và luồng dữ liệu, build 36

Rà soát ngày 15/10/2026. Thay đổi lần này tập trung giao diện; các đề xuất dữ liệu bên dưới chưa được triển khai. Không chạy migration hoặc sửa dữ liệu người dùng.

## UI đã sửa

- Dùng bộ token chung trong `zminutes-tokens.css`: tím chủ đạo `#7360f2`, nền tím nhạt, chữ tối, viền và focus thống nhất. Giữ màu trạng thái task và lỗi.
- Sửa các shorthand CSS sai như `font:700 13px inherit`. Font dùng Segoe UI với system fallback; nội dung 14–15px, nhãn 13px, mô tả 12px, tiêu đề mục 18px. Trên mobile, field nhập liệu 16px để dễ đọc và tránh zoom khi focus.
- Input/select một dòng cao 44px, chung padding/viền/bo góc. Textarea nhiều dòng theo chức năng, không ép cùng chiều cao với input. Notes/Recap vẫn giữ phân cấp nội dung.
- Chuẩn hóa nút, card, label của Tasks/Field notes, form People, dialog tạo meeting, Settings, Calendar, Files, dashboard, metadata và các tab meeting.
- Audio: bỏ Download/Transcribe trùng phía trên; mỗi recording có bốn nút icon cùng hàng và vùng bấm 44px. Delete có xác nhận như trước. Player mở khi Play; tên dài có tooltip.
- Manual transcript nằm trong mục Add text có thể mở/đóng. Nội dung cũ vẫn nằm trong bản transcript tổng hợp và vẫn được lưu.
- Ngôn ngữ đích dùng dropdown và Other language; giữ được lựa chọn cũ. AI trả tên ngôn ngữ nguồn cùng kết quả dịch, hiển thị một ngôn ngữ hoặc Mixed. Nếu thiếu metadata, hiển thị Not identified, không suy đoán từ bảng chữ cái. Metadata được loại khỏi nội dung bản dịch.
- Màu thanh PWA và icon đổi cùng theme; build/cache tăng 36. Script `scripts/build-icons.cjs` tạo PNG từ SVG nguồn.
- Tách CSS inline khỏi HTML sang `zminutes-layout.css`, giữ nguyên thứ tự cascade để tránh thay đổi layout ngoài ý muốn. Các màu thương hiệu dùng token chung trong các stylesheet hiện hữu.

## Luồng dữ liệu đang có

| Luồng | Nơi xử lý | Kết quả rà soát |
| --- | --- | --- |
| Notes → autosave | `zminutes-rich-notes.js`, `zminutes-app.js` | JSON Tiptap là nguồn chính; text dẫn xuất cập nhật sau debounce. Flush trước navigation, AI, sync, export. Save lỗi giữ pending và có Retry. |
| Legacy Notes → JSON | `zminutes-repository.js`, `zminutes-editor-entry.js` | Lưu bản Markdown gốc trước chuyển đổi, có tải bản gốc và test idempotent. |
| Ghi âm → media → transcript | `zminutes-audio.js`, `zminutes-intelligence.js` | Audio nằm IndexedDB, có checkpoint; segment gắn recording ID, thứ tự giữ khi xóa audio. Import audio hiện vẫn tự transcribe nếu meeting cho phép cloud. |
| Transcript → dịch → Notes | `zminutes-intelligence.js` | Dịch theo từng phần, chặn áp dụng nếu đổi meeting/source/target; Add to Notes lưu sourceBlock rồi flush. Bản dịch nháp chỉ ở RAM. |
| Notes + transcript + agenda + people + tasks → Recap | `zminutes-intelligence.js` | Flush rồi chụp dữ liệu meeting; hai nút cùng luồng; lỗi giữ recap cũ. Có lượt AI riêng cho nguồn đã Add to Notes. |
| Project → Solutions | `zminutes-intelligence.js` | Gemini/OpenAI có web sources; Ollama dùng context nội bộ. Có giới hạn số bản ghi và độ dài, hiện không thông báo phần bị cắt. |
| Tasks / Field notes / Projects | `zminutes-app.js`, `zminutes-views.js` | Bản đã submit lưu qua repository; bản đang nhập dùng draft trong RAM. Di chuyển meeting cập nhật các task liên kết tuần tự. |
| PDF / Word / Share / Email | `zminutes-exports.js` | Chỉ meeting metadata, Recap, Solutions và nguồn; không trộn notes/transcript/audio. Nội dung recap được chuyển thành text trong bản xuất. |
| Backup / Restore | `zminutes-repository.js`, `zminutes-sync.js` | Backup toàn workspace có media. Restore validate trước và ghi trong transaction; có confirm và tải backup trước restore. Restore là thay thế dữ liệu, không phải merge. |
| Raw Data một meeting | `zminutes-exports.js` | Có JSON Notes, transcript, recap, ảnh/audio trong meeting. Không chứa các task riêng có meetingId trỏ đến meeting này. |
| Drive Sync | `zminutes-sync.js`, `zminutes-repository.js`, `zminutes-model.js` | Journal thay đổi bất biến, xử lý conflict, v3 tách client v2; verify upload trước acknowledge. Notes, tasks, field notes và ảnh sync; raw audio, Files và API keys ở local. |
| Calendar / nhắc việc | `zminutes-exports.js`, `zminutes-reminders.js` | Import/export ICS, re-import tránh lặp. Recurrence chưa được mở rộng tự động. Nhắc khi app đang mở/visible; chưa có luồng Telegram trong module hiện hành. |

## Đề xuất ưu tiên — chưa sửa trong build 36

### P1: Biết chính xác Recap đang dựa trên dữ liệu nào

`recap()` lưu kết quả vào meeting sau khi AI xong nhưng không lưu revision/hash nguồn. Người dùng sửa Notes trong lúc AI chạy thì kết quả vẫn từ snapshot trước đó; recap cũ cũng không có nhãn Out of date sau khi thêm transcript.

Đề xuất lưu fingerprint của Notes/transcript/agenda/tasks/people/prompt, thời điểm tạo và provider/model; so sánh trước khi ghi và trước export. Hiển thị “New content — regenerate recap”, giữ được bản cũ. Kiểm thử bằng AI trả chậm, sửa Notes giữa chừng, rồi reload/sync. Đây là ưu tiên đầu tiên vì gần nhất với các lỗi người dùng từng gặp.

### P1: Raw Data phải mang theo task liên kết

`meetingPackage()` chỉ xuất một object meeting từ `portable().meetings`; import chỉ tạo meeting mới. Task là entity độc lập nên không theo package và ID meeting mới chưa được remap cho task.

Đề xuất package mới có meeting + linkedTasks + media; import remap ID và kiểm tra liên kết trong một transaction. Giữ khả năng import v3 cũ. Round-trip cần chứng minh task/nhắc việc vẫn gắn đúng meeting, không sinh bản trùng khi retry.

### P1: Làm rõ Restore sẽ ảnh hưởng các thiết bị khác

`restore()` tạo journal operation cả cho bản ghi bị loại khỏi backup. Lần Sync sau có thể truyền những thay đổi/xóa này sang thiết bị khác. UI confirm hiện chỉ nói thay dữ liệu trên thiết bị này, chưa diễn đạt tác động đó.

Đề xuất mặc định “Import missing / Merge”, kèm preview số thêm/sửa/xóa; giữ Replace là lựa chọn rõ ràng và mô tả tác động lên lần Sync tiếp theo. Backup trước restore nên được checkpoint trong IndexedDB, vì việc gọi download không xác nhận người dùng đã lưu file thành công. Không thay ngữ nghĩa restore âm thầm.

### P2: Lưu bản dịch và draft nhập liệu có trạng thái rõ ràng

`A.translation`, `A.drafts.task`, `A.drafts.field` nằm RAM. Bản dịch đã Add to Notes được lưu; draft chưa thêm hoặc form chưa submit có thể mất sau reload.

Đề xuất draft store riêng theo meeting/project ID, debounce và hiển thị Saved draft. Translation cần source hash, ngôn ngữ nguồn/đích và timestamp để tránh dùng nhầm kết quả cũ. Không coi một form chưa submit là task đã tạo.

### P2: Context Solutions phải minh bạch và có nguồn ổn định

Code lấy tối đa 12 meetings, 40 tasks, 20 field notes; cắt từng trường rồi cắt toàn chuỗi JSON ở 36.000 ký tự. Điều này có thể cắt giữa bản ghi và bỏ ý mới ở cuối tài liệu.

Đề xuất chọn context theo mức liên quan + mới nhất, tính ngân sách từng bản ghi trước serialize, hiện “Using N meetings”, dẫn nguồn bằng ID+tiêu đề. Kiểm thử bằng project lớn, nội dung quan trọng ở cuối Notes và meeting trùng tên.

### P2: Giảm chi phí journal/sync và export lớn

Merge đọc toàn journal để reduce; bundle đính ảnh liên quan mỗi batch; backup/raw package dùng data URL và tạo toàn bộ JSON trong RAM. Ghi âm dài trên tablet có thể tiêu tốn nhiều bộ nhớ, chưa có benchmark định lượng.

Đề xuất đo trước với workspace lớn; giới hạn payload theo byte, tách media theo hash, snapshot journal có giữ tombstone/conflict và mốc tương thích; xuất ZIP/media theo luồng. Chưa nên thay thuật toán sync nếu chưa có test thiết bị cũ, retry, concurrent edit và mạng đứt.

### P2: Gộp các thay đổi liên kết thành transaction

Di chuyển meeting và task giữa projects, import meeting/media/files đang là nhiều thao tác liên tiếp. Nếu lỗi giữa chừng, có thể để dữ liệu liên kết ở hai project hoặc import dở.

Đề xuất repository operation cho cả nhóm, có ID import để retry idempotent; test lỗi ghi ở bước giữa và khởi động lại. Calendar/Telegram nên làm sau các ưu tiên dữ liệu này.

### P2: Từ Action item trong Notes sang task có hạn xử lý

Handler `data-insert` hiện gọi `insertCallout()` trong editor. Đây là ghi chú có loại, chưa tạo entity task; quick recap lấy Action items từ danh sách tasks riêng. Người dùng có thể tưởng một action ghi trong Notes đã có trong Tasks/Calendar, nhưng thực tế chưa liên kết.

Đề xuất nút Convert to task trên callout: lấy nội dung, chọn hạn/nhắc, tạo task có meetingId và lưu liên kết về block. Không tự biến mọi dòng AI sinh ra thành task. Test tạo một lần, sửa, xóa và sync để tránh task trùng.

## Kiểm chứng và giới hạn

- `npm test`: 24 ca repository/model/recording; không có dữ liệu thật bị sửa.
- `npm run test:browser`: workflow thật trong trình duyệt với mic tổng hợp và mock AI/Drive. Bổ sung kiểm tra hàng Audio ở 360/412/800/1024/1366px, form cao 44px/font thống nhất, target custom, source language/mixed/missing, collapsed manual transcript và navigation.
- Screenshot từng màn desktop 1366, Pixel 6 viewport 412, ET40 viewport 800; thêm Calendar, Files và project Field notes vào kiểm tra UI.
- Đã xem ảnh Audio, Notes, Transcript, Agenda, People, Tasks, Calendar, Settings, dashboard và project Field notes; ảnh cuối được tạo trong `test-results/`.
- Đây là mô phỏng viewport trong Edge desktop, chưa phải kiểm thử phần cứng Pixel 6/ET40, bàn phím Android, microphone thật hoặc provider/Drive tài khoản thật. Không gọi API trả phí.
- Chưa tách Audio thành tab riêng trên mobile. Chưa refactor hết cấu trúc stylesheet cũ thành component; token chung giải quyết màu/kích thước hiện tại, cấu trúc cascade vẫn là nợ kỹ thuật cần xử lý có ảnh hồi quy.
- Các phát hiện dữ liệu là review code và kiểm thử hiện có, không phải cam kết đã loại bỏ mọi lỗi. Những cải tiến P1/P2 ở trên đều chưa triển khai trong đợt UI này.
