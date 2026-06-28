Component({
  properties: {
    visible: { type: Boolean, value: false },
    fileId: { type: String, value: '' },
    title: { type: String, value: '科普海报' }
  },

  data: {
    tempFilePath: '',
    saving: false
  },

  observers: {
    visible(val) {
      // 弹窗关闭时重置临时文件路径
      if (!val) {
        this.setData({ tempFilePath: '', saving: false });
      }
    }
  },

  methods: {
    /**
     * 保存海报到相册
     */
    async onSave() {
      if (this.data.saving || !this.data.fileId) return;
      this.setData({ saving: true });

      try {
        // 先下载云文件到本地临时路径
        let tempPath = this.data.tempFilePath;
        if (!tempPath) {
          const dlRes = await wx.cloud.downloadFile({
            fileID: this.data.fileId
          });
          tempPath = dlRes.tempFilePath;
          this.setData({ tempFilePath: tempPath });
        }

        // 保存到相册
        await wx.saveImageToPhotosAlbum({ filePath: tempPath });
        wx.showToast({ title: '保存成功', icon: 'success' });
      } catch (err) {
        if (err.errMsg && err.errMsg.includes('auth deny')) {
          wx.showModal({
            title: '提示',
            content: '需要相册权限才能保存图片，请在设置中开启',
            confirmText: '去设置',
            success(res) {
              if (res.confirm) {
                wx.openSetting();
              }
            }
          });
        } else {
          wx.showToast({ title: '保存失败', icon: 'error' });
        }
      } finally {
        this.setData({ saving: false });
      }
    },

    /**
     * 全屏预览图片
     */
    onPreview() {
      if (!this.data.fileId) return;
      wx.previewImage({
        urls: [this.data.fileId],
        current: this.data.fileId
      });
    },

    /**
     * 关闭查看器
     */
    onClose() {
      this.triggerEvent('close');
    }
  }
});
