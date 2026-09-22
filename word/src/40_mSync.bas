Attribute VB_Name = "mSync"
Option Explicit

' ================= «Синхронизировать фрагменты из CSV Студии» =================
' разбор fish-CSV (формат buildCsv) и расстановка строк «фрагмент | …» по блокам

Private Type SyRow
    kind As String
    num As Long
    file As String
    tin As String
    tout As String
    path As String
End Type

Public Function ParseCsvRow(ByVal t As String, ByVal ch As String) As Variant
    Dim out() As Variant, n As Long, i As Long, cur As String, q As Boolean, c As String
    ReDim out(0 To 15)
    n = 0
    For i = 1 To Len(t)
        c = Mid$(t, i, 1)
        If q Then
            If c = """" Then
                If i < Len(t) Then
                    If Mid$(t, i + 1, 1) = """" Then
                        cur = cur & """"
                        i = i + 1
                    Else
                        q = False
                    End If
                Else
                    q = False
                End If
            Else
                cur = cur & c
            End If
        Else
            If c = """" Then
                q = True
            ElseIf c = ch Then
                If n > UBound(out) Then ReDim Preserve out(0 To n * 2)
                out(n) = cur
                n = n + 1
                cur = ""
            Else
                cur = cur & c
            End If
        End If
    Next i
    If n > UBound(out) Then ReDim Preserve out(0 To n)
    out(n) = cur
    ReDim Preserve out(0 To n)
    For i = LBound(out) To UBound(out)
        out(i) = Trim$(Replace(CStr(out(i)), vbVerticalTab, " "))
    Next i
    ParseCsvRow = out
End Function

' возвращает отчёт; текст — содержимое fish-CSV Студии (UTF-8)
Public Function SyncFromCsvText(doc As Document, ByVal text As String) As String
    Scan doc
    Dim rep As String, notes As String
    text = Replace(text, vbCr, "")
    Dim lines As Variant
    lines = SplitParts(text, vbLf)

    Dim sep As String
    sep = ""
    Dim i As Long, t As String, cells As Variant
    For i = LBound(lines) To UBound(lines)
        t = Trim$(CStr(lines(i)))
        If Left$(t, 4) = "файл" Then
            If InStr(t, ";") > 0 Then sep = ";" Else sep = ","
        End If
    Next i
    If Len(sep) = 0 Then
        SyncFromCsvText = "Не найден заголовок «файл;вход;выход;…» — это fish-CSV Студии?"
        Exit Function
    End If

    ' детект формата: есть ли #-секции
    Dim hasSections As Boolean: hasSections = False
    For i = LBound(lines) To UBound(lines)
        t = Trim$(CStr(lines(i)))
        If Left$(t, 1) = "#" And InStr(t, ChrW(8212) & ChrW(8212) & ChrW(8212)) > 0 Then
            hasSections = True: Exit For
        End If
    Next i

    Dim rows() As SyRow, n As Long
    ReDim rows(0 To 63)
    n = 0
    Dim curKind As String, curNum As Long
    Dim csvFps As String

    If hasSections Then
        ' --- формат с #-секциями (старый) ---
        For i = LBound(lines) To UBound(lines)
            t = Trim$(CStr(lines(i)))
            If Len(t) = 0 Then GoTo nxSec
            If Left$(t, 1) = "#" Then
                Dim ss As String
                ss = NormSp(Mid$(t, 2))
                If StartsWith(ss, "Таймкод:") Then
                    Dim pp As Long, qq As Long, r As String
                    pp = InStr(ss, "NDF ")
                    If pp > 0 Then
                        r = Mid$(ss, pp + 4)
                        qq = InStr(r, " ")
                        If qq > 0 Then r = Left$(r, qq - 1)
                        If Len(r) > 0 Then csvFps = r
                    End If
                End If
                If InStr(t, ChrW(8212) & ChrW(8212) & ChrW(8212)) > 0 Then
                    curKind = "": curNum = 0
                    Dim sec As String, p1 As Long
                    sec = Mid$(t, 7)
                    p1 = InStr(sec, ChrW(8212) & ChrW(8212) & ChrW(8212))
                    If p1 > 0 Then sec = Trim$(Left$(sec, p1 - 1)) Else sec = ""
                    Dim l As String: l = LCase$(sec)
                    Dim tail As String
                    If StartsWith(l, "синхрон") Then
                        tail = Mid$(l, 8): curKind = "sync": curNum = FirstNum(tail)
                    ElseIf StartsWith(l, "стендап") Then
                        curKind = "standup": curNum = FirstNum(Mid$(l, 9))
                    ElseIf StartsWith(l, "лайф") Then
                        curKind = "life": curNum = FirstNum(Mid$(l, 5))
                    ElseIf StartsWith(l, "шпигель") Then
                        curKind = "spiegel": curNum = 1
                    Else
                        curKind = ""
                    End If
                End If
                GoTo nxSec
            End If
            cells = ParseCsvRow(t, sep)
            If UBound(cells) < 2 Then GoTo nxSec
            If cells(0) = "файл" Or cells(0) = "№" Then GoTo nxSec
            If Len(curKind) = 0 Then
                notes = notes & "Строка без раздела: " & Left$(t, 40) & vbLf
                GoTo nxSec
            End If
            If n > UBound(rows) Then ReDim Preserve rows(0 To n * 2)
            rows(n).kind = curKind: rows(n).num = curNum
            rows(n).file = CStr(cells(0)): rows(n).tin = CStr(cells(1))
            rows(n).tout = CStr(cells(2))
            If UBound(cells) >= 4 Then rows(n).path = CStr(cells(4)) Else rows(n).path = CStr(cells(0))
            n = n + 1
nxSec:
        Next i
    Else
        ' --- чистый формат (без секций) — распределяем по блокам с фрагментами ---
        Dim fragBlockIdx As Long: fragBlockIdx = 0
        For i = LBound(lines) To UBound(lines)
            t = Trim$(CStr(lines(i)))
            If Len(t) = 0 Then GoTo nxFlat
            If Left$(t, 1) = "#" Then GoTo nxFlat
            cells = ParseCsvRow(t, sep)
            If UBound(cells) < 2 Then GoTo nxFlat
            If cells(0) = "файл" Or cells(0) = "№" Then GoTo nxFlat

            ' найти следующий блок, у которого может быть фрагмент
            Do While fragBlockIdx < NBlk
                Dim fb As Blk: fb = BlkArr(fragBlockIdx)
                If fb.kind <> "headline" And fb.kind <> "vo" And fb.kind <> "vod" Then Exit Do
                fragBlockIdx = fragBlockIdx + 1
            Loop
            If fragBlockIdx >= NBlk Then
                notes = notes & "Фрагмент «" & Left$(t, 40) & "» — нет подходящего блока" & vbLf
                GoTo nxFlat
            End If
            If n > UBound(rows) Then ReDim Preserve rows(0 To n * 2)
            rows(n).kind = BlkArr(fragBlockIdx).kind
            rows(n).num = BlkArr(fragBlockIdx).num
            rows(n).file = CStr(cells(0)): rows(n).tin = CStr(cells(1))
            rows(n).tout = CStr(cells(2))
            rows(n).path = CStr(cells(0))
            n = n + 1
nxFlat:
        Next i
    End If

    If Len(csvFps) > 0 Then
        If LCase$(csvFps) <> LCase$(FpsS) Then
            notes = notes & "FPS в CSV: " & csvFps & ", в документе: " & FpsS & " (взят из CSV)" & vbLf
            FpsS = csvFps
            Fb = ClngSafe(csvFps, 25)
            WriteParLine doc
        End If
    End If

    If n = 0 Then
        SyncFromCsvText = "В CSV нет строк с фрагментами." & vbCrLf & notes
        Exit Function
    End If

    ' применяем по блокам: совпадение (kind,num) среди блоков документа
    Dim used() As Boolean
    ReDim used(0 To n - 1)
    Dim matched As Long
    Dim b As Long
    For b = 0 To NBlk - 1
        Dim bi As Long
        bi = b
        Dim cnt As Long: cnt = 0
        For i = 0 To n - 1
            If Not used(i) Then
                If rows(i).kind = BlkArr(bi).kind And rows(i).num = BlkArr(bi).num Then cnt = cnt + 1
            End If
        Next i
        If cnt > 0 Then
            ReplaceBlockFrags doc, bi, rows, used, cnt
            matched = matched + cnt
        End If
    Next b
    For i = 0 To n - 1
        If Not used(i) Then
            notes = notes & "В документе нет блока «" & KindName(rows(i).kind) & " " & rows(i).num & _
                    "» — строка " & rows(i).file & " пропущена" & vbLf
        End If
    Next i
    For b = 0 To NBlk - 1
        If BlkArr(b).nFrag > 0 And HasFragInCsv(rows, n, BlkArr(b).kind, BlkArr(b).num) = False Then
            notes = notes & KindName(BlkArr(b).kind) & " " & BlkArr(b).num & _
                    ": в CSV таких фрагментов нет, в документе сохранены прежние" & vbLf
        End If
    Next b
    Scan doc
    FixSpecialStyles doc
    rep = "Синхронизировано фрагментов: " & matched
    If Len(notes) > 0 Then rep = rep & vbCrLf & "---" & vbCrLf & Replace(notes, vbLf, vbCrLf)
    SyncFromCsvText = rep
End Function

Private Function HasFragInCsv(ByRef rows() As SyRow, ByVal n As Long, _
        ByVal kind As String, ByVal num As Long) As Boolean
    Dim i As Long
    For i = 0 To n - 1
        If rows(i).kind = kind And rows(i).num = num Then HasFragInCsv = True: Exit Function
    Next i
End Function

' удаляет старые строки «фрагмент |» блока bi и вставляет новые
Private Sub ReplaceBlockFrags(doc As Document, ByVal bi As Long, ByRef rows() As SyRow, _
        ByRef used() As Boolean, ByVal cnt As Long)
    Dim kind As String, num As Long
    kind = BlkArr(bi).kind: num = BlkArr(bi).num
    ' 1) удалить существующие
    Dim del() As Long, nd As Long, i As Long, raw As String, t As String
    ReDim del(0 To 63)
    nd = 0
    For i = BlkArr(bi).headIdx + 1 To BlkArr(bi).lastIdx
        raw = doc.Paragraphs(i).Range.Text
        t = NormSp(Left$(raw, Len(raw) - 1))
        If StartsWith(t, FRAG_PFX) Then
            If nd > UBound(del) Then ReDim Preserve del(0 To nd * 2)
            del(nd) = i
            nd = nd + 1
        End If
    Next i
    For i = nd - 1 To 0 Step -1
        doc.Paragraphs(del(i)).Range.Delete
    Next i
    ' 2) заново просканировать и вставить в конец блока
    Scan doc
    Dim b2 As Long
    For b2 = 0 To NBlk - 1
        If BlkArr(b2).kind = kind And BlkArr(b2).num = num Then Exit For
    Next b2
    If b2 > NBlk - 1 Then Exit Sub
    Dim ins As Long
    For i = 0 To UBound(rows)
        If Not used(i) Then
            If rows(i).kind = kind And rows(i).num = num Then
                Dim f As Frag
                f.file = rows(i).file: f.tin = rows(i).tin
                f.tout = rows(i).tout: f.path = rows(i).path
                ins = BlkArr(b2).lastIdx
                InsertParAfter doc, ins, FragLine(f), ST_FRAG
                used(i) = True
                Scan doc
                For b2 = 0 To NBlk - 1
                    If BlkArr(b2).kind = kind And BlkArr(b2).num = num Then Exit For
                Next b2
            End If
        End If
    Next i
End Sub

' --------- запись строки «параметры | …» (создаёт после реквизитов, если нет) ---------
Public Sub WriteParLine(doc As Document)
    EnsureStyles doc
    Scan doc
    Dim i As Long, raw As String, t As String
    If ParIdx > 0 Then
        raw = doc.Paragraphs(ParIdx).Range.Text
        doc.Paragraphs(ParIdx).Range.Text = ParLine() & vbCr
    Else
        Dim anchor As Long
        anchor = ReqIdx
        If anchor = 0 Then
            If NBlk > 0 Then anchor = BlkArr(0).headIdx - 1 Else anchor = doc.Paragraphs.Count
        End If
        If anchor < 1 Then anchor = 1
        InsertParAfter doc, anchor, ParLine(), ST_PAR
    End If
    FixSpecialStyles doc
End Sub
